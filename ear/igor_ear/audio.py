"""The microphone, read from PipeWire through `parec`.

PipeWire lets several programs read the same microphone, so this runs next
to linux-voice-assistant without taking it away. parec resamples to 16 kHz
mono, which is what both models want.

A USB microphone that drops and comes back (a loose plug, a USB hub, a VM's
USB passthrough) is a new PipeWire source with a new number: a stream reading
the old one is quietly moved elsewhere and hears nothing of the room. So the
source's number is watched, and when it changes the reading starts again on
the microphone (and `on_reconnect` lets the satellite do the same).
"""
from __future__ import annotations

import logging
import subprocess
import time
from collections.abc import Callable, Iterator

import numpy as np

from .segmenter import FRAME, RATE

log = logging.getLogger("igor-ear")


CHECK_S = 10.0


def source_index(source: str) -> int | None:
    """The PipeWire number of a source by its name (None: not there, or no pactl)."""
    try:
        out = subprocess.run(["pactl", "list", "short", "sources"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) > 1 and parts[1] == source and parts[0].isdigit():
            return int(parts[0])
    return None


def frames(source: str, on_reconnect: Callable[[], None] | None = None) -> Iterator[np.ndarray]:
    """Yield float32 frames of FRAME samples, forever, restarting parec if it stops
    or if the microphone came back as a new source."""
    cmd = [
        "parec", "--device", source, "--format=s16le", f"--rate={RATE}", "--channels=1",
        "--latency-msec=60", "--client-name=igor-ear", "--raw",
    ]
    size = FRAME * 2
    named = source not in ("", "default", "@DEFAULT_SOURCE@")
    known: int | None = None
    while True:
        index = source_index(source) if named else None
        if named and index is None:
            log.warning("Microphone %s absent; waiting for it", source)
            time.sleep(5)
            continue
        if named and known is not None and index != known:
            log.warning("Microphone back as a new source (%s → %s): reading it again", known, index)
            if on_reconnect:
                try:
                    on_reconnect()
                except Exception as err:  # noqa: BLE001 - never in the way of listening
                    log.warning("After the microphone came back: %s", err)
        known = index
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except FileNotFoundError:
            raise SystemExit("parec is missing: sudo apt install pulseaudio-utils") from None
        assert proc.stdout is not None
        checked = time.monotonic()
        moved = False
        try:
            while True:
                data = proc.stdout.read(size)
                if len(data) < size:
                    break
                yield np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                if named and time.monotonic() - checked > CHECK_S:
                    checked = time.monotonic()
                    if source_index(source) != known:
                        moved = True
                        break
        finally:
            proc.kill()
            err = (proc.stderr.read() if proc.stderr else b"").decode(errors="replace").strip()
            proc.wait()
        if moved:
            continue  # the new source is read at once (its number checked above)
        log.warning("Microphone stream stopped%s; retrying in 5 s", f": {err}" if err else "")
        time.sleep(5)
