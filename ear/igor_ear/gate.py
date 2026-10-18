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
    closes for the whole announce call. Home Assistant may return before
    the voice is even heard (the satellite still fetching the sound), so
    when the speakers are watched and were quiet, the ear stays closed
    until the voice has come out of them (`start_wait` seconds at most)
    and they are quiet again (`longest` at most); with something already
    playing (a television), the speakers say nothing of the voice, and
    `settle` seconds are waited. Then a short `tail` for the room's echo.

    `speakers` needs `listening`, `last_sound` (its clock) and
    `quiet_for(seconds)`, like speakers.Speakers."""

    def __init__(self, speakers=None, tail: float = 0.3, settle: float = 2.0, start_wait: float = 4.0,
                 longest: float = 60.0, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], None] = time.sleep) -> None:
        self.speakers, self.tail, self.settle = speakers, tail, settle
        self.start_wait, self.longest = start_wait, longest
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

    def _wait(self, done: Callable[[], bool], seconds: float) -> None:
        limit = self.clock() + seconds
        while not done() and self.clock() < limit:
            self.sleep(0.05)

    def say(self, speak: Callable[[], None]) -> None:
        with self._lock:
            self._speaking += 1
        began = self.clock()
        sp = self.speakers
        watched = sp is not None and sp.listening
        busy_before = watched and not sp.quiet_for(0.5)
        try:
            speak()
        finally:
            returned = self.clock()
            how = "speakers not watched"
            if watched and not busy_before:
                # The voice must have come out, then stopped.
                self._wait(lambda: sp.last_sound >= began, max(0.0, began + self.start_wait - self.clock()))
                heard = sp.last_sound >= began
                self._wait(lambda: sp.quiet_for(self.tail), self.longest)
                how = "voice seen on the speakers" if heard else "voice never seen on the speakers"
            elif watched:
                self._wait(lambda: sp.quiet_for(self.tail), self.settle)
                how = "something else playing"
            with self._lock:
                self._speaking -= 1
                self._until = max(self._until, self.clock() + self.tail)
                self.ended = self._until
            log.info("Ear closed %.1f s while Igor spoke (announce %.1f s, then %.1f s: %s)",
                     self.ended - began, returned - began, self.ended - returned, how)
