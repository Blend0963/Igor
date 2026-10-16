"""Cut the microphone stream into utterances, from voice activity.

Fed one 512-sample frame (32 ms at 16 kHz) and its speech probability at a
time; returns a finished utterance when someone has stopped talking.
"""
from __future__ import annotations

from collections import deque

import numpy as np

FRAME = 512
RATE = 16000


class Segmenter:
    def __init__(
        self,
        start_threshold: float = 0.5,
        end_threshold: float = 0.35,
        start_frames: int = 3,
        end_silence_ms: int = 700,
        preroll_ms: int = 320,
        min_speech_ms: int = 400,
        max_utterance_s: float = 15.0,
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

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    def reset(self) -> None:
        self._preroll.clear()
        self._frames = []
        self._in_speech = False
        self._above = self._silence = self._speech = 0

    def push(self, frame: np.ndarray, prob: float) -> np.ndarray | None:
        """Add one frame; return the utterance (float32 samples) once it ends."""
        if not self._in_speech:
            self._preroll.append(frame)
            self._above = self._above + 1 if prob >= self.start_threshold else 0
            if self._above >= self.start_frames:
                self._in_speech = True
                self._frames = list(self._preroll)
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
            frames, speech = self._frames, self._speech
            self.reset()
            if speech < self.min_speech_frames:
                return None
            return np.concatenate(frames)
        return None
