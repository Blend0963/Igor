"""Answers to the name said alone, never the same one twice in a row."""

from __future__ import annotations

import random
import threading


class Deck:
    """Deals every reply once, in random order, before shuffling again.

    A new round never starts with the reply that ended the last one."""

    def __init__(self, replies: list[str], rng: random.Random | None = None) -> None:
        self._replies = list(dict.fromkeys(replies))
        self._rng = rng or random.Random()
        self._left: list[str] = []
        self._last: str | None = None
        self._lock = threading.Lock()

    def __bool__(self) -> bool:
        return bool(self._replies)

    def draw(self) -> str:
        with self._lock:
            if not self._left:
                self._left = self._replies[:]
                self._rng.shuffle(self._left)
                if len(self._left) > 1 and self._left[-1] == self._last:
                    self._left[0], self._left[-1] = self._left[-1], self._left[0]
            self._last = self._left.pop()
            return self._last
