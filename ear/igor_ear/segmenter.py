"""Cut the microphone stream into utterances, from voice activity.

Fed one 512-sample frame (32 ms at 16 kHz) and its speech probability at a
time; returns a finished utterance when someone has stopped talking, with
its start and end on the stream's own clock (seconds of audio read), so a
sentence interrupted by a pause can be joined back together.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass

import numpy as np

FRAME = 512
RATE = 16000


@dataclass
class Utterance:
    audio: np.ndarray
    start: float  # stream seconds
    end: float


class Segmenter:
    def __init__(
        self,
        start_threshold: float = 0.5,
        end_threshold: float = 0.35,
        start_frames: int = 3,
        end_silence_ms: int = 700,
        # A soft first sound (the "I" of "Igor") is detected late: keep
        # what came just before the voice was noticed.
        preroll_ms: int = 700,
        # "Igor" said alone, before a pause, lasts about a third of a second.
        min_speech_ms: int = 250,
        max_utterance_s: float = 60.0,
    ) -> None:
        ms = FRAME * 1000 / RATE
        self.start_threshold = start_threshold
        self.end_threshold = end_threshold
        self.start_frames = start_frames
        self.end_frames = max(1, round(end_silence_ms / ms))
        self.min_speech_frames = max(1, round(min_speech_ms / ms))
        self.max_frames = max(1, round(max_utterance_s * 1000 / ms))
        self._preroll: deque[np.ndarray] = deque(maxlen=max(1, round(preroll_ms / ms)))
        self._frames: list[np.ndarray] = []
        self._in_speech = False
        self._above = 0
        self._silence = 0
        self._speech = 0
        self._seen = 0
        self._start = 0.0
        # Sounds dropped as too short to be speech, for a full journal.
        self.too_short = 0
        self.too_short_ms = 0

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    @property
    def now(self) -> float:
        """Seconds of audio read so far."""
        return self._seen * FRAME / RATE

    @property
    def speech_start(self) -> float:
        """Start of the utterance being heard (meaningful while in_speech)."""
        return self._start

    def reset(self) -> None:
        self._preroll.clear()
        self._clear()

    def _clear(self) -> None:
        self._frames = []
        self._in_speech = False
        self._above = self._silence = self._speech = 0

    def push(self, frame: np.ndarray, prob: float) -> Utterance | None:
        """Add one frame; return the utterance once it ends."""
        self._seen += 1
        if not self._in_speech:
            self._preroll.append(frame)
            self._above = self._above + 1 if prob >= self.start_threshold else 0
            if self._above >= self.start_frames:
                self._in_speech = True
                self._frames = list(self._preroll)
                self._start = self.now - len(self._frames) * FRAME / RATE
                self._preroll.clear()
                self._speech = self._above
                self._silence = 0
            return None

        self._frames.append(frame)
        if prob >= self.end_threshold:
            self._speech += 1
            self._silence = 0
        else:
            self._silence += 1
        if self._silence >= self.end_frames or len(self._frames) >= self.max_frames:
            frames, speech, start = self._frames, self._speech, self._start
            self._clear()
            if speech < self.min_speech_frames:
                self.too_short += 1
                self.too_short_ms = round(speech * FRAME * 1000 / RATE)
                return None
            return Utterance(np.concatenate(frames), start, self.now)
        return None
