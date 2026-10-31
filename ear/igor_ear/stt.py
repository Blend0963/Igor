"""Local transcription: whisper.cpp's server, or faster-whisper.

With `[stt] server` set, each sentence goes to whisper-server on this
machine (whisper.cpp, Vulkan: any GPU, AMD included, about half a second a
sentence), the one Home Assistant's own speech-to-text uses. Otherwise
faster-whisper runs here: on an NVIDIA GPU (the GTX 960, compute capability
5.2, runs float32 only: "small" takes about 1 GB of its 2 GB), else int8 on
the CPU, slow and poor at a distance.
"""
from __future__ import annotations

import io
import json
import logging
import subprocess
import sys
import time
import urllib.request
import uuid
import wave
from dataclasses import dataclass

import numpy as np

log = logging.getLogger("igor-ear")

# Loads the model on the GPU and runs it once, in a separate process: a GPU
# library problem can kill a process outright (segmentation fault), and
# that must not be the service's own.
PROBE = (
    "import sys, numpy as np; from faster_whisper import WhisperModel; "
    "m = WhisperModel(sys.argv[1], device='cuda', compute_type='float32'); "
    "s, _ = m.transcribe(np.zeros(16000, dtype=np.float32), language='fr'); list(s)"
)


def gpu_works(model: str, timeout: float = 600) -> tuple[bool, str]:
    try:
        r = subprocess.run([sys.executable, "-c", PROBE, model], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "timed out"
    if r.returncode == 0:
        return True, ""
    reason = (r.stderr.strip().splitlines() or [f"exit code {r.returncode}"])[-1]
    if r.returncode < 0:
        reason = f"crashed (signal {-r.returncode}); {reason}"
    return False, reason


@dataclass
class Transcript:
    text: str
    seconds: float
    no_speech: float
    logprob: float


# A voice from across the room arrives faint, and Whisper hears faint words
# worse. Each sentence is brought up to this peak before it is transcribed
# (never down, at most 8 times): the microphone's own gain is left alone,
# since raising it makes close voices saturate.
TARGET_PEAK = 0.6
MAX_GAIN = 8.0


def louder(audio: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak <= 0 or peak >= TARGET_PEAK:
        return audio
    return (audio * min(TARGET_PEAK / peak, MAX_GAIN)).astype(np.float32)


def wav_bytes(audio: np.ndarray, rate: int = 16000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
    return buffer.getvalue()


def server_transcribe(url: str, audio: np.ndarray, language: str, prompt: str, timeout: float = 30) -> dict:
    """POST one sentence to whisper.cpp's /inference; its verbose JSON."""
    boundary = uuid.uuid4().hex
    fields = [("response_format", "verbose_json"), ("temperature", "0.0"), ("language", language)]
    if prompt:
        fields.append(("prompt", prompt))
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode() for k, v in fields]
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n'
                 "Content-Type: audio/wav\r\n\r\n".encode() + wav_bytes(audio) + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        f"{url.rstrip('/')}/inference",
        data=b"".join(parts),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read())


def read_server(reply: dict) -> tuple[str, float, float]:
    """Text, doubt that it is speech, and confidence, from whisper.cpp's
    reply. Older servers give no doubt or confidence: taken as speech."""
    segments = [s for s in reply.get("segments") or [] if isinstance(s, dict)]
    text = str(reply.get("text") or " ".join(str(s.get("text", "")) for s in segments)).strip()
    if not segments:
        return text, (0.0 if text else 1.0), 0.0
    no_speech = max(float(s.get("no_speech_prob", 0.0)) for s in segments)
    logprob = min(float(s.get("avg_logprob", 0.0)) for s in segments)
    return text, no_speech, logprob


class Transcriber:
    def __init__(
        self,
        model: str = "small",
        device: str = "auto",
        language: str = "fr",
        cpu_threads: int = 2,
        hotwords: str = "Igor",
        beam_size: int = 0,
        server: str = "",
    ) -> None:
        self.language = language
        self.server = ""
        if server:
            try:
                start = time.monotonic()
                server_transcribe(server, np.zeros(16000, dtype=np.float32), language, hotwords)
                self.server, self.device, self.beam_size = server, f"whisper-server {server}", 0
                self.hotwords = hotwords
                log.info("Transcription: whisper-server at %s (%.1f s for one second of silence)",
                         server, time.monotonic() - start)
                return
            except Exception as err:  # noqa: BLE001 - faster-whisper here instead
                log.warning("whisper-server at %s unavailable (%s); transcribing here instead", server, err)
        from faster_whisper import WhisperModel

        # "Igor" is no French word: told to expect it, Whisper writes it the
        # same way every time.
        self.hotwords = hotwords or None
        # Greedy decoding drops rare words like the name; several beams keep
        # it, at little cost on a GPU. 0 means: 5 on a GPU, 1 on a CPU.
        self.beam_size = 1
        attempts = [("cuda", "float32"), ("cpu", "int8")] if device == "auto" else [
            (device, "float32" if device == "cuda" else "int8")
        ]
        last: Exception | None = None
        for dev, compute in attempts:
            if dev == "cuda":
                works, reason = gpu_works(model)
                if not works:
                    log.warning("GPU unusable, skipped: %s", reason)
                    last = RuntimeError(reason)
                    continue
            try:
                self._model = WhisperModel(model, device=dev, compute_type=compute, cpu_threads=cpu_threads)
                self.beam_size = beam_size or (5 if dev == "cuda" else 1)
                # A first, silent run loads every library now rather than on the first sentence.
                self._run(np.zeros(16000, dtype=np.float32))
                self.device = f"{dev}/{compute}"
                log.info("Transcription: model %s on %s, beam %d", model, self.device, self.beam_size)
                return
            except Exception as err:  # noqa: BLE001 - try the next device
                last = err
                log.warning("Transcription on %s/%s unavailable: %s", dev, compute, err)
        raise RuntimeError(f"No device can run the transcription: {last}")

    def _run(self, audio: np.ndarray):
        segments, _info = self._model.transcribe(
            audio,
            language=self.language,
            hotwords=self.hotwords,
            beam_size=self.beam_size,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            without_timestamps=True,
            vad_filter=False,
        )
        return list(segments)

    def __call__(self, audio: np.ndarray) -> Transcript:
        start = time.monotonic()
        if self.server:
            try:
                text, no_speech, logprob = read_server(
                    server_transcribe(self.server, louder(audio), self.language, self.hotwords or ""))
            except Exception as err:  # noqa: BLE001 - one sentence lost, not the service
                log.warning("whisper-server failed on this sentence: %s", err)
                text, no_speech, logprob = "", 1.0, -10.0
            return Transcript(text, time.monotonic() - start, no_speech, logprob)
        segments = self._run(louder(audio))
        text = " ".join(s.text.strip() for s in segments).strip()
        no_speech = max((s.no_speech_prob for s in segments), default=1.0)
        logprob = min((s.avg_logprob for s in segments), default=-10.0)
        return Transcript(text, time.monotonic() - start, no_speech, logprob)
