"""Is sound coming out of this machine's speakers right now?

The hub sends the whole house's audio (television, radio, a phone over
Bluetooth, EasyEffects) to its speakers, so the most direct way to know
whether something is playing is to listen to what goes out: the monitor of
the output sink, read at a low rate (parec, 8 kHz mono, a few kilobytes a
second). A level above `quiet_db` means sound; it counts for `hold` seconds
more, so the pauses in a film or a song do not reopen the smart judge
between two lines.

With PipeWire the monitor carries the sound before the sink's volume, so a
muted sink, or one at 0 %, still shows the music there. Its mute and volume
are read too (pactl, every two seconds): muted or at zero is silence.
"""
from __future__ import annotations

import logging
import math
import os
import re
import subprocess
import threading
import time
from typing import Callable

import numpy as np

log = logging.getLogger(__name__)

RATE = 8000
CHUNK = RATE // 4          # samples per measure: a quarter of a second
VOLUME_EVERY = 2.0         # seconds between two mute/volume readings
# pactl is localised ("Muet : non"); its English output is what is parsed.
C_LOCALE = {**os.environ, "LC_ALL": "C"}


def level_db(samples: np.ndarray) -> float:
    """RMS level of 16-bit samples, in dB below full scale (silence: -inf)."""
    if samples.size == 0:
        return -math.inf
    rms = math.sqrt(float(np.mean(samples.astype(np.float64) ** 2)))
    return 20 * math.log10(rms / 32768) if rms > 0 else -math.inf


def parse_mute(text: str) -> bool | None:
    m = re.search(r"Mute:\s*(yes|no)", text)
    return None if m is None else m.group(1) == "yes"


def parse_volume(text: str) -> int | None:
    """The loudest channel, in percent."""
    found = [int(v) for v in re.findall(r"(\d+)%", text)]
    return max(found) if found else None


class Speakers:
    def __init__(
        self,
        sink: str = "@DEFAULT_SINK@",
        quiet_db: float = -50.0,
        hold: float = 3.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.sink = sink
        self.monitor = "@DEFAULT_MONITOR@" if sink == "@DEFAULT_SINK@" else f"{sink}.monitor"
        self.quiet_db, self.hold, self.clock = quiet_db, hold, clock
        self.last_sound = -math.inf
        self.muted: bool | None = None
        self.volume: int | None = None
        self.listening = False     # the monitor is being read
        self.level = -math.inf     # last measure, for the logs

    # --- state -------------------------------------------------------------
    def feed(self, level: float) -> None:
        self.level = level
        if level > self.quiet_db:
            self.last_sound = self.clock()

    def sounding(self, unknown: bool = True) -> bool:
        """Sound is coming out. `unknown` when the monitor cannot be read."""
        if not self.listening:
            return unknown
        if self.muted or self.volume == 0:
            return False
        return self.clock() - self.last_sound < self.hold

    def quiet_for(self, seconds: float) -> bool:
        """No sound out for `seconds` (true when the monitor cannot be read)."""
        return not self.listening or self.clock() - self.last_sound >= seconds

    # --- reading -----------------------------------------------------------
    def start(self) -> None:
        threading.Thread(target=self._read_monitor, daemon=True).start()
        threading.Thread(target=self._read_volume, daemon=True).start()

    def _read_monitor(self) -> None:
        delay = 5
        while True:
            try:
                proc = subprocess.Popen(
                    ["parec", f"--device={self.monitor}", "--format=s16le", f"--rate={RATE}",
                     "--channels=1", "--latency-msec=100", "--client-name=igor-ear-speakers"],
                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                )
                log.info("Speakers: watching %s (sound above %.0f dB counts as playing)", self.monitor, self.quiet_db)
                while True:
                    raw = proc.stdout.read(CHUNK * 2)
                    if not raw:
                        break
                    self.listening = True
                    delay = 5
                    self.feed(level_db(np.frombuffer(raw, dtype=np.int16)))
                proc.wait()
            except OSError as err:
                log.warning("Speakers: cannot read %s (%s)", self.monitor, err)
            self.listening = False
            time.sleep(delay)
            delay = min(delay * 2, 120)

    def _read_volume(self) -> None:
        while True:
            try:
                mute = subprocess.run(["pactl", "get-sink-mute", self.sink], capture_output=True,
                                      text=True, timeout=5, env=C_LOCALE).stdout
                volume = subprocess.run(["pactl", "get-sink-volume", self.sink], capture_output=True,
                                        text=True, timeout=5, env=C_LOCALE).stdout
                self.muted, self.volume = parse_mute(mute), parse_volume(volume)
            except (OSError, subprocess.SubprocessError):
                self.muted = self.volume = None
            time.sleep(VOLUME_EVERY)
