"""The microphone, read from PipeWire through `parec`.

PipeWire lets several programs read the same microphone, so this runs next
to linux-voice-assistant without taking it away. parec resamples to 16 kHz
mono, which is what both models want.
"""
from __future__ import annotations

import logging
import subprocess
import time
from collections.abc import Iterator

import numpy as np

from .segmenter import FRAME, RATE

log = logging.getLogger("mado-ear")


def frames(source: str) -> Iterator[np.ndarray]:
    """Yield float32 frames of FRAME samples, forever, restarting parec if it stops."""
    cmd = [
        "parec", "--device", source, "--format=s16le", f"--rate={RATE}", "--channels=1",
        "--latency-msec=60", "--client-name=mado-ear", "--raw",
    ]
    size = FRAME * 2
    while True:
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except FileNotFoundError:
            raise SystemExit("parec is missing: sudo apt install pulseaudio-utils") from None
        assert proc.stdout is not None
        try:
            while True:
                data = proc.stdout.read(size)
                if len(data) < size:
                    break
                yield np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
        finally:
            proc.kill()
            err = (proc.stderr.read() if proc.stderr else b"").decode(errors="replace").strip()
            proc.wait()
        log.warning("Microphone stream stopped%s; retrying in 5 s", f": {err}" if err else "")
        time.sleep(5)
