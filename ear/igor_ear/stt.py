"""Local transcription with faster-whisper.

On the GTX 960 (compute capability 5.2) CTranslate2 only runs float32, so
the default is the "small" model in float32 on the GPU (about 1 GB of its
2 GB), falling back to int8 on the CPU when the GPU cannot be used.
"""
from __future__ import annotations

import io
import json
import logging
import os
import subprocess
import sys
import time
import urllib.request
import wave
from dataclasses import dataclass, field
from types import SimpleNamespace

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
    # With a whisper.cpp server: (start, end, text, words) of each piece, the
    # words being {word, start, end} with the times in seconds.
    parts: list = field(default_factory=list)


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


class Transcriber:
    def __init__(
        self,
        model: str = "small",
        device: str = "auto",
        language: str = "fr",
        cpu_threads: int = 2,
        hotwords: str = "Igor",
        beam_size: int = 0,
        server_url: str = "",
    ) -> None:
        # Fast enough to transcribe a whole long sentence (a GPU, a server).
        self.full = False
        server_url = server_url or os.environ.get("IGOR_WHISPER_URL", "").strip()
        if server_url and self._init_server(server_url, language, hotwords):
            return
        from faster_whisper import WhisperModel

        self.language = language
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
                self.full = dev == "cuda"
                log.info("Transcription: model %s on %s, beam %d", model, self.device, self.beam_size)
                return
            except Exception as err:  # noqa: BLE001 - try the next device
                last = err
                log.warning("Transcription on %s/%s unavailable: %s", dev, compute, err)
        raise RuntimeError(f"No device can run the transcription: {last}")

    def _init_server(self, url: str, language: str, hotwords: str) -> bool:
        """Transcribe with a whisper.cpp server (any GPU it runs on) instead of
        faster-whisper. False, and faster-whisper is used, if it does not answer."""
        self._url = url.rstrip("/") + "/inference"
        self.language, self.hotwords, self.beam_size = language, hotwords or None, 5
        try:
            self._post(np.zeros(16000, dtype=np.float32))
        except Exception as err:  # noqa: BLE001 - faster-whisper then
            log.warning("whisper-server unusable (%s): falling back", err)
            return False
        self._run = self._run_server
        self.device = "whisper.cpp"
        self.full = True
        log.info("Transcription: whisper.cpp server at %s", self._url)
        return True

    def _post(self, audio: np.ndarray) -> dict:
        pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        wav = io.BytesIO()
        with wave.open(wav, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(pcm)
        boundary = "igorear" + str(time.monotonic_ns())
        fields = {"temperature": "0.0", "response_format": "verbose_json", "language": self.language}
        if self.hotwords:
            fields["prompt"] = self.hotwords
        body = b""
        for k, v in fields.items():
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n'
                 "Content-Type: audio/wav\r\n\r\n").encode() + wav.getvalue() + f"\r\n--{boundary}--\r\n".encode()
        request = urllib.request.Request(self._url, data=body,
                                         headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        with urllib.request.urlopen(request, timeout=30) as r:
            return json.loads(r.read())

    def _run_server(self, audio: np.ndarray):
        try:
            data = self._post(audio)
        except Exception as err:  # noqa: BLE001 - heard as silence
            log.warning("whisper-server error: %s", err)
            return []
        pieces = data.get("segments") or []
        if not pieces and data.get("text", "").strip():
            pieces = [{"text": data["text"]}]
        return [SimpleNamespace(text=g.get("text", ""), no_speech_prob=g.get("no_speech_prob", 0.0),
                                avg_logprob=g.get("avg_logprob", 0.0), timed="start" in g,
                                start=g.get("start", 0.0), end=g.get("end", 0.0),
                                words=g.get("words") or []) for g in pieces]

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
        segments = self._run(louder(audio))
        text = " ".join(s.text.strip() for s in segments).strip()
        no_speech = max((s.no_speech_prob for s in segments), default=1.0)
        logprob = min((s.avg_logprob for s in segments), default=-10.0)
        parts = [(s.start, s.end, s.text.strip(), s.words) for s in segments if getattr(s, "timed", False)]
        return Transcript(text, time.monotonic() - start, no_speech, logprob, parts)
