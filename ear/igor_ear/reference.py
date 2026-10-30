"""The television, as it enters the sound card.

A second stream reads a sound card input (what a video projector or a box
feeds the speakers) and keeps the last minute. When someone says "Igor" while
the television is on, the television's own words for that moment are
transcribed and compared with what the microphone heard: the words found in
both are the television's.
"""
from __future__ import annotations

import difflib
import threading
import time
from collections import deque

import numpy as np

from .addressing import normalize
from .audio import frames
from .segmenter import FRAME, RATE

# A word of the microphone and the same word of the television can be this far
# apart (seconds): the loopback, the room, the two transcriptions' timings.
MATCH_WINDOW = 4.0
# A one- or two-word hole between television words is the television's too.
MAX_HOLE = 2


class Reference:
    def __init__(self, source: str, seconds: float = 70.0) -> None:
        self.source = source
        self._ring: deque = deque(maxlen=int(seconds * RATE / FRAME))
        self._lock = threading.Lock()

    def start(self) -> None:
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self) -> None:
        for frame in frames(self.source):
            with self._lock:
                self._ring.append((time.monotonic(), frame))

    def audio(self, t0: float, t1: float) -> np.ndarray | None:
        """What was heard between two moments of time.monotonic()."""
        with self._lock:
            got = [f for t, f in self._ring if t0 < t <= t1 + FRAME / RATE]
        return np.concatenate(got) if got else None


def merge_parts(parts) -> list[tuple[str, float, float, str]]:
    """Timed words (text, start, end, normalized) from a transcription's
    pieces. whisper.cpp gives word fragments ("all", "ume"): a piece without
    a leading space continues the previous word."""
    out: list[list] = []
    for part in parts:
        cur = None
        for w in (part[3] if len(part) > 3 else []):
            t = w.get("word", "")
            if not t.strip() or "start" not in w or "end" not in w:
                continue
            if cur is not None and not t[0].isspace():
                cur[0] += t
                cur[2] = w["end"]
            else:
                if cur is not None:
                    out.append(cur)
                cur = [t.strip(), w["start"], w["end"]]
        if cur is not None:
            out.append(cur)
    return [(a, b, c, normalize(a)) for a, b, c in out]


def tv_flags(mic: list, tv: list, window: float = MATCH_WINDOW, keep=()) -> list[bool]:
    """For each microphone word, whether the television said it too around
    the same time. Two matching words in a row, or one long word, count; then
    a hole of one or two words between television words (a word one of the
    two hearings missed) is the television's. Words in `keep` never are."""
    cand = []
    for _t, s, _e, n in mic:
        hit = False
        for _t2, s2, _e2, n2 in tv:
            if abs(s - s2) > window or not n or not n2:
                continue
            if n == n2 or (len(n) >= 4 and len(n2) >= 4 and difflib.SequenceMatcher(None, n, n2).ratio() >= 0.8):
                hit = True
                break
        cand.append(hit)
    size = len(mic)
    flags = [False] * size
    i = 0
    while i < size:
        if cand[i]:
            j = i
            while j < size and cand[j]:
                j += 1
            if j - i >= 2 or len(mic[i][3]) >= 5:
                for k in range(i, j):
                    flags[k] = True
            i = j
        else:
            i += 1
    i = 0
    while i < size:
        if not flags[i]:
            j = i
            while j < size and not flags[j]:
                j += 1
            if 0 < i and j < size and j - i <= MAX_HOLE:
                for k in range(i, j):
                    flags[k] = True
            i = j
        else:
            i += 1
    for k in keep:
        flags[k] = False
    return flags
