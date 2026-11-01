"""This machine's graphics card, published to Home Assistant for the wall
tablet: load, temperature and video memory of an AMD card (amdgpu), read
from sysfs, posted as sensor states every `interval` seconds.

Home Assistant keeps such states until it restarts; the next post brings
them back. Nothing is sent when no AMD card is found.
"""

from __future__ import annotations

import glob
import json
import logging
import os
import threading
import time
import urllib.request
from dataclasses import dataclass

log = logging.getLogger("igor-ear")

DRM = "/sys/class/drm"


@dataclass
class Gpu:
    load: float | None = None          # %
    temperature: float | None = None   # °C, edge
    junction: float | None = None      # °C, hottest spot
    vram_used: int | None = None       # bytes
    vram_total: int | None = None      # bytes


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="ascii") as f:
            return f.read().strip()
    except OSError:
        return None


def _number(path: str) -> float | None:
    text = _read(path)
    try:
        return float(text) if text is not None else None
    except ValueError:
        return None


def find_card(root: str = DRM) -> str | None:
    """The device directory of the first AMD card that reports its load."""
    for card in sorted(glob.glob(os.path.join(root, "card[0-9]*"))):
        device = os.path.join(card, "device")
        if os.path.exists(os.path.join(device, "gpu_busy_percent")):
            return device
    return None


def read_gpu(device: str) -> Gpu:
    g = Gpu()
    g.load = _number(os.path.join(device, "gpu_busy_percent"))
    used = _number(os.path.join(device, "mem_info_vram_used"))
    total = _number(os.path.join(device, "mem_info_vram_total"))
    g.vram_used = int(used) if used is not None else None
    g.vram_total = int(total) if total is not None else None
    for hwmon in sorted(glob.glob(os.path.join(device, "hwmon", "hwmon*"))):
        for i in range(1, 6):
            value = _number(os.path.join(hwmon, f"temp{i}_input"))
            if value is None:
                continue
            label = (_read(os.path.join(hwmon, f"temp{i}_label")) or "").lower()
            celsius = round(value / 1000, 1)
            if label == "junction":
                g.junction = celsius
            elif label in ("edge", "") and g.temperature is None:
                g.temperature = celsius
        if g.temperature is not None:
            break
    return g


def states(g: Gpu, prefix: str) -> dict[str, dict]:
    """Entity id -> {state, attributes}, for what the card reported."""
    out: dict[str, dict] = {}
    if g.load is not None:
        out[f"sensor.{prefix}_gpu_load"] = {
            "state": round(g.load),
            "attributes": {"unit_of_measurement": "%", "state_class": "measurement",
                           "friendly_name": "GPU load", "icon": "mdi:expansion-card"},
        }
    if g.temperature is not None:
        attrs = {"unit_of_measurement": "°C", "device_class": "temperature", "state_class": "measurement",
                 "friendly_name": "GPU temperature"}
        if g.junction is not None:
            attrs["junction"] = g.junction
        out[f"sensor.{prefix}_gpu_temperature"] = {"state": g.temperature, "attributes": attrs}
    if g.vram_used is not None and g.vram_total:
        gib = 1024 ** 3
        out[f"sensor.{prefix}_gpu_memory"] = {
            "state": round(100 * g.vram_used / g.vram_total),
            "attributes": {"unit_of_measurement": "%", "state_class": "measurement",
                           "friendly_name": "GPU memory", "icon": "mdi:memory",
                           "used_gib": round(g.vram_used / gib, 1), "total_gib": round(g.vram_total / gib, 1)},
        }
    return out


def post(url: str, token: str, entity: str, body: dict, timeout: float = 5) -> None:
    request = urllib.request.Request(
        url.rstrip("/") + "/api/states/" + entity,
        data=json.dumps(body).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "igor-ear"},
    )
    with urllib.request.urlopen(request, timeout=timeout):
        pass


class Publisher:
    """Posts the card's sensors every `interval` seconds, in a daemon thread."""

    def __init__(self, url: str, token: str, prefix: str = "igor_ear", interval: float = 30, device: str | None = None):
        self.url, self.token, self.prefix = url, token, prefix
        self.interval = max(5.0, interval)
        self.device = device or find_card()
        self._failed = False

    def once(self) -> int:
        if not self.device:
            return 0
        sent = 0
        for entity, body in states(read_gpu(self.device), self.prefix).items():
            post(self.url, self.token, entity, body)
            sent += 1
        return sent

    def _loop(self) -> None:
        while True:
            try:
                self.once()
                if self._failed:
                    log.info("Graphics card stats: sent again")
                self._failed = False
            except Exception as err:  # noqa: BLE001 - never stop the ear for this
                if not self._failed:
                    log.warning("Graphics card stats not sent: %s", err)
                self._failed = True
            time.sleep(self.interval)

    def start(self) -> bool:
        if not self.device:
            log.info("Graphics card stats: no AMD card found, nothing sent")
            return False
        log.info("Graphics card stats: %s, sent every %d s as sensor.%s_gpu_*", self.device, self.interval, self.prefix)
        threading.Thread(target=self._loop, daemon=True, name="gpu-stats").start()
        return True
