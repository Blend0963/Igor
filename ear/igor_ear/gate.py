"""Is linux-voice-assistant busy, so igor-ear should stay quiet?

Busy while the satellite listens after its own wake word, processes, or
speaks, and for a short tail after (the end of its own voice). A state
that lasts far longer than any real exchange is a stuck satellite, or one
that reports "listening" all the time (wake word handled in Home
Assistant, audio always streaming): it is then ignored, or igor-ear would
never hear anything again.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable

log = logging.getLogger("igor-ear")

BUSY = {"listening", "processing", "responding"}
TAIL = 1.5
# Longest a real exchange keeps each state; beyond, the state is stale.
STALE = {"listening": 30.0, "processing": 90.0, "responding": 180.0}


class SatelliteGate:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._state: str | None = None
        self._since = clock()
        self._last_busy = float("-inf")
        self._warned = False

    def update(self, state: str | None) -> None:
        """A new state from Home Assistant."""
        if state != self._state:
            if self._state in BUSY and not self._stale():
                self._last_busy = self.clock()
            self._state, self._since, self._warned = state, self.clock(), False

    def _stale(self) -> bool:
        return self._state in STALE and self.clock() - self._since > STALE[self._state]

    def busy(self, tail: bool = True) -> bool:
        """`tail`: count the short time after a busy state too."""
        if self._state in BUSY:
            if not self._stale():
                self._last_busy = self.clock()
                return True
            if not self._warned:
                log.warning("Satellite %s for over %.0f s: taken as stuck, ignored", self._state, STALE[self._state])
                self._warned = True
        return tail and self.clock() - self._last_busy < TAIL


class OwnVoice:
    """While Igor speaks through the satellite, igor-ear hears nothing.

    The microphone is in the same room as the speakers: what Igor says
    ("Oui, monsieur ?", an answer) would come back as a sentence. The ear
    closes for the whole announce call (Home Assistant returns once the
    satellite has finished), then stays closed until the speakers are quiet
    (`quiet(seconds)`, when they are watched) or `settle` seconds at most,
    plus a short `tail` for the room's echo."""

    def __init__(self, quiet: Callable[[float], bool] | None = None, tail: float = 0.3, settle: float = 2.0,
                 clock: Callable[[], float] = time.monotonic, sleep: Callable[[float], None] = time.sleep) -> None:
        self.quiet, self.tail, self.settle = quiet, tail, settle
        self.clock, self.sleep = clock, sleep
        self._speaking = 0
        self._until = float("-inf")
        self.ended = float("-inf")
        self._lock = threading.Lock()

    def speaking(self) -> bool:
        return self._speaking > 0 or self.clock() < self._until

    def just_spoke(self, within: float = TAIL + 1.0) -> bool:
        """Igor's own voice ended this recently: the satellite's tail after
        it is already covered here."""
        return not self.speaking() and self.clock() - self.ended < within

    def say(self, speak: Callable[[], None]) -> None:
        with self._lock:
            self._speaking += 1
        try:
            speak()
        finally:
            if self.quiet is not None:
                limit = self.clock() + self.settle
                while not self.quiet(self.tail) and self.clock() < limit:
                    self.sleep(0.05)
            with self._lock:
                self._speaking -= 1
                self._until = max(self._until, self.clock() + self.tail)
                self.ended = self._until
