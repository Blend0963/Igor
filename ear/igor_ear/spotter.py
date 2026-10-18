"""A second ear for the name: Vosk, a small French recogniser on the CPU.

Whisper "base" sometimes writes the name as another word ("Hector",
"ignore"), above all when it is said alone. Vosk hears the same sentence
with its own, different model (40 MB, about 100 MB of memory, a fraction of
a second on the CPU): the name heard by either one counts. Vosk runs with
its full vocabulary: limited to the names, it would force them onto any
close sound ("il faut" heard as "igor", "ma douche" as "mado").
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import numpy as np

log = logging.getLogger("igor-ear")

RATE = 16000
# Below this, Vosk is unsure the word was the name.
MIN_CONFIDENCE = 0.6


@dataclass
class Spot:
    """What Vosk heard: the names, where, and whether anything else was said."""

    names: list[str] = field(default_factory=list)
    others: int = 0               # other words
    first: bool = False           # a name was the first word
    last: bool = False            # a name was the last word

    @property
    def found(self) -> bool:
        return bool(self.names)

    @property
    def alone(self) -> bool:
        return self.found and self.others == 0


def read(result: dict, names: set[str], min_confidence: float = MIN_CONFIDENCE) -> Spot:
    """A Vosk result (with SetWords) as a Spot."""
    words = result.get("result") or [{"word": w, "conf": 1.0} for w in result.get("text", "").split()]
    spot = Spot()
    for i, w in enumerate(words):
        if w.get("word") in names and float(w.get("conf", 1.0)) >= min_confidence:
            spot.names.append(w["word"])
            spot.first = spot.first or i == 0
            spot.last = spot.last or i == len(words) - 1
        else:
            spot.others += 1
    return spot


class Spotter:
    def __init__(self, model_path: str, names: list[str]) -> None:
        from vosk import KaldiRecognizer, Model, SetLogLevel

        SetLogLevel(-1)
        self._model = Model(model_path)
        self._names = {n.lower() for n in names}
        self._kaldi = KaldiRecognizer
        # Made once: a new recogniser costs far more than a sentence. After
        # FinalResult it starts afresh for the next one.
        self._recognizer = self._new_recognizer()
        log.info("Name spotter: Vosk (%s) listening for %s", model_path, ", ".join(sorted(self._names)))

    def _new_recognizer(self):
        r = self._kaldi(self._model, RATE)
        r.SetWords(True)
        return r

    def __call__(self, audio: np.ndarray) -> Spot:
        r = self._recognizer
        try:
            r.AcceptWaveform((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
            return read(json.loads(r.FinalResult()), self._names)
        except Exception:
            # A recogniser left half-way is not trusted with the next sentence.
            self._recognizer = self._new_recognizer()
            raise
