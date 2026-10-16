"""Local transcription with faster-whisper.

On the GTX 960 (compute capability 5.2) CTranslate2 only runs float32, so
the default is the "small" model in float32 on the GPU (about 1 GB of its
2 GB), falling back to int8 on the CPU when the GPU cannot be used.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import numpy as np

log = logging.getLogger("mado-ear")


@dataclass
class Transcript:
    text: str
    seconds: float
    no_speech: float
    logprob: float


class Transcriber:
    def __init__(self, model: str = "small", device: str = "auto", language: str = "fr", cpu_threads: int = 2) -> None:
        from faster_whisper import WhisperModel

        self.language = language
        attempts = [("cuda", "float32"), ("cpu", "int8")] if device == "auto" else [
            (device, "float32" if device == "cuda" else "int8")
        ]
        last: Exception | None = None
        for dev, compute in attempts:
            try:
                self._model = WhisperModel(model, device=dev, compute_type=compute, cpu_threads=cpu_threads)
                # A first, silent run loads every library now rather than on the first sentence.
                self._run(np.zeros(16000, dtype=np.float32))
                self.device = f"{dev}/{compute}"
                log.info("Transcription: model %s on %s", model, self.device)
                return
            except Exception as err:  # noqa: BLE001 - try the next device
                last = err
                log.warning("Transcription on %s/%s unavailable: %s", dev, compute, err)
        raise RuntimeError(f"No device can run the transcription: {last}")

    def _run(self, audio: np.ndarray):
        segments, _info = self._model.transcribe(
            audio,
            language=self.language,
            beam_size=1,
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
