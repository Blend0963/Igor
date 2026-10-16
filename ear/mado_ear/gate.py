"""Is linux-voice-assistant busy, so mado-ear should stay quiet?

Busy while the satellite listens after its own wake word, processes, or
speaks, and for a short tail after (the end of its own voice). A state
that lasts far longer than any real exchange is a stuck satellite, or one
that reports "listening" all the time (wake word handled in Home
Assistant, audio always streaming): it is then ignored, or mado-ear would
never hear anything again.
"""
from __future__ import annotations

import logging
import time
from typing import Callable

log = logging.getLogger("mado-ear")

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

    def busy(self) -> bool:
        if self._state in BUSY:
            if not self._stale():
                self._last_busy = self.clock()
                return True
            if not self._warned:
                log.warning("Satellite %s for over %.0f s: taken as stuck, ignored", self._state, STALE[self._state])
                self._warned = True
        return self.clock() - self._last_busy < TAIL
