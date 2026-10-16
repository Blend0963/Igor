"""Local transcription with faster-whisper.

On the GTX 960 (compute capability 5.2) CTranslate2 only runs float32, so
the default is the "small" model in float32 on the GPU (about 1 GB of its
2 GB), falling back to int8 on the CPU when the GPU cannot be used.
"""
from __future__ import annotations

import logging
import subprocess
import sys
import time
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


class Transcriber:
    def __init__(
        self,
        model: str = "small",
        device: str = "auto",
        language: str = "fr",
        cpu_threads: int = 2,
        hotwords: str = "Igor",
        beam_size: int = 0,
    ) -> None:
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
        segments = self._run(audio)
        text = " ".join(s.text.strip() for s in segments).strip()
        no_speech = max((s.no_speech_prob for s in segments), default=1.0)
        logprob = min((s.avg_logprob for s in segments), default=-10.0)
        return Transcript(text, time.monotonic() - start, no_speech, logprob)
