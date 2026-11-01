"""The desk screen shared by this machine and a PC: this machine shows Igor's
wall dashboard on its graphics card's output, and hands the screen over.

`run.sh screen`, started by the kiosk session (sway, see screen/), does:

- the keyboard: when the USB keyboard leaves this machine (the USB switch
  pressed towards the PC), the screen goes to the PC's input; when it comes
  back, the screen wakes and comes here. The machine that loses the keyboard
  sends the screen away: a monitor obeys DDC/CI on the input it shows.
- orders from Home Assistant, the `igor_screen` event: `pc`, `dashboard`
  (also `vm`), `off`, `on`, `toggle`; `app` with `app: sound | equalizer |
  bluetooth` opens that settings window over the dashboard, `close` closes
  them. A script fires it from a dashboard button, an automation or Igor.
- its state, `sensor.igor_screen` (`on` or `off`, with the keyboard).

The display is put to sleep by switching the output off (swaymsg): the
monitor, without a signal, goes to standby by itself.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
import time
from dataclasses import dataclass, field

log = logging.getLogger("igor-ear")

INPUT_DEVICES = "/proc/bus/input/devices"
# A keyboard on a long or weak USB link drops for a moment and comes back:
# only this long without it is the USB switch pressed towards the PC.
GONE_AFTER = 3.0

# The settings windows a dashboard button may open over the dashboard: these
# only, never a command sent by Home Assistant.
APPS = {
    "sound": "pavucontrol",
    "equalizer": "easyeffects",
    "bluetooth": "blueman-manager",
}
# Their windows, as sway knows them (sway.conf floats them the same way).
APP_WINDOWS = r"^(org\.pulseaudio\.pavucontrol|pavucontrol|com\.github\.wwmm\.easyeffects|blueman-manager|\.blueman-manager-wrapped)$"


# ----- the keyboard -----
# Letter keys and the space bar (linux/input-event-codes.h): a USB sound card,
# a headset or a remote also declares itself a keyboard ("kbd", for its volume
# keys), but only a real keyboard has these.
TYPING_KEYS = (16, 30, 44, 57)  # KEY_Q, KEY_A, KEY_Z, KEY_SPACE


def key_bits(text: str) -> int:
    """The `B: KEY=` bitmap: hex words, the most significant first, each one a
    64-bit word with its leading zeros left out."""
    value = 0
    for word in text.split():
        value = (value << 64) | int(word, 16)
    return value


@dataclass
class InputDevice:
    name: str = ""
    bus: str = ""
    handlers: list[str] = field(default_factory=list)
    keys: int | None = None  # None: the bitmap was not listed

    def types(self) -> bool:
        if self.keys is None:
            return True
        return all(self.keys >> k & 1 for k in TYPING_KEYS)


def parse_inputs(text: str) -> list[InputDevice]:
    """The input devices listed in /proc/bus/input/devices."""
    out: list[InputDevice] = []
    for block in text.split("\n\n"):
        dev = InputDevice()
        for line in block.splitlines():
            if line.startswith("I:"):
                m = re.search(r"Bus=([0-9a-fA-F]+)", line)
                dev.bus = m.group(1).lower() if m else ""
            elif line.startswith("N:"):
                m = re.search(r'Name="(.*)"', line)
                dev.name = m.group(1) if m else ""
            elif line.startswith("H:"):
                dev.handlers = line.split("=", 1)[1].split() if "=" in line else []
            elif line.startswith("B: KEY="):
                try:
                    dev.keys = key_bits(line.split("=", 1)[1])
                except ValueError:
                    dev.keys = None
        if dev.name:
            out.append(dev)
    return out


def keyboard_here(devices: list[InputDevice], match: str = "") -> bool:
    """A real USB keyboard is plugged in: the virtual machine's own devices
    (QEMU's tablet and keyboard) and USB devices with a few media keys only
    (a sound card) do not count. `match`: a part of its name."""
    for d in devices:
        if d.bus != "0003" or "kbd" not in d.handlers or not d.types():
            continue
        if d.name.upper().startswith("QEMU"):
            continue
        if match and match.lower() not in d.name.lower():
            continue
        return True
    return False


def read_keyboard(match: str = "", path: str = INPUT_DEVICES) -> bool:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return keyboard_here(parse_inputs(f.read()), match)
    except OSError:
        return False


# ----- the monitor (DDC/CI) and the output -----
def ddc_bus(connector: str, drm: str = "/sys/class/drm") -> int | None:
    """The I2C bus that talks to the monitor on `connector` (e.g. HDMI-A-1)."""
    for card in sorted(os.listdir(drm)) if os.path.isdir(drm) else []:
        if not card.endswith("-" + connector):
            continue
        ddc = os.path.join(drm, card, "ddc")
        target = os.path.realpath(ddc) if os.path.exists(ddc) else ""
        m = re.search(r"i2c-(\d+)$", target)
        if m:
            return int(m.group(1))
        # Some drivers put the adapter inside the connector's directory.
        for entry in os.listdir(os.path.join(drm, card)):
            m = re.fullmatch(r"i2c-(\d+)", entry)
            if m:
                return int(m.group(1))
    return None


def run(cmd: list[str], timeout: float = 10) -> bool:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as err:
        log.warning("Screen: %s failed: %s", cmd[0], err)
        return False
    if r.returncode != 0:
        log.warning("Screen: %s: %s", " ".join(cmd), (r.stderr or r.stdout).strip()[:200])
        return False
    return True


@dataclass
class ScreenSettings:
    output: str = "HDMI-A-1"         # this machine's output, as sway names it
    here: int = 0x11                 # the monitor's input for this machine (MCCS: 0x11 HDMI 1)
    pc: int = 0x0F                   # the PC's input (0x0F DisplayPort 1)
    bus: int | None = None           # I2C bus of the monitor; None: from the output
    keyboard: str = ""               # part of the keyboard's name; empty: any USB keyboard
    pc_entity: str = ""              # the PC's ping in Home Assistant: not sent there while it is off
    event: str = "igor_screen"
    sensor: str = "sensor.igor_screen"


class Screen:
    def __init__(self, s: ScreenSettings, ha_url: str = "", ha_token: str = "",
                 runner=run, keyboard_reader=read_keyboard):
        self.s = s
        self.url, self.token = ha_url, ha_token
        self.run = runner
        self.read_keyboard = keyboard_reader
        self.bus = s.bus if s.bus is not None else ddc_bus(s.output)
        self.on = True
        self.keyboard = False
        self.pc_state: str | None = None
        self.lock = threading.Lock()

    # what can be done
    def power(self, on: bool) -> None:
        if self.run(["swaymsg", "output", self.s.output, "power", "on" if on else "off"]):
            self.on = on
            log.info("Screen: %s", "on" if on else "off (standby)")
        self.publish()

    def select(self, value: int) -> bool:
        if self.bus is None:
            log.warning("Screen: no DDC bus for %s; set [screen] bus", self.s.output)
            return False
        ok = self.run(["ddcutil", "--bus", str(self.bus), "--noverify", "setvcp", "60", f"0x{value:02x}"])
        if ok:
            log.info("Screen: input 0x%02x (%s)", value, "here" if value == self.s.here else "the PC")
        return ok

    def pc_off(self) -> bool:
        return (self.pc_state or "").lower() in {"off", "not_home", "unavailable"}

    def act(self, action: str, data: dict | None = None) -> None:
        action = (action or "").strip().lower()
        with self.lock:
            if action == "pc":
                if self.pc_off():
                    log.info("Screen: the PC is off, the dashboard stays")
                    return
                self.select(self.s.pc)
            elif action in {"dashboard", "vm", "here"}:
                if not self.on:
                    self.power(True)
                self.select(self.s.here)
            elif action == "off":
                self.power(False)
            elif action == "on":
                self.power(True)
            elif action == "toggle":
                self.power(not self.on)
            elif action == "app":
                name = str((data or {}).get("app", "")).strip().lower()
                if name not in APPS:
                    log.warning("Screen: unknown settings window %r (%s)", name, ", ".join(APPS))
                    return
                if not self.on:
                    self.power(True)
                # Chromium's kiosk asks to be fullscreen, which would hide the window.
                self.run(["swaymsg", '[app_id="^chromium"]', "fullscreen", "disable"])
                if self.run(["swaymsg", "exec", APPS[name]]):
                    log.info("Screen: %s opened", APPS[name])
            elif action == "close":
                self.run(["swaymsg", f'[app_id="{APP_WINDOWS}"]', "kill"])
                self.run(["swaymsg", '[app_id="^chromium"]', "fullscreen", "enable"])
            else:
                log.warning("Screen: unknown order %r", action)

    # the keyboard, read every half second
    def keyboard_changed(self, present: bool) -> None:
        if present == self.keyboard:
            return
        self.keyboard = present
        log.info("Screen: keyboard %s", "here" if present else "gone")
        if present:
            self.act("dashboard")
        else:
            self.act("pc")
        self.publish()

    def keyboard_seen(self, present: bool, now: float) -> None:
        """One reading of the keyboard: back at once, gone only after
        GONE_AFTER seconds without it (a flaky link resets it every second)."""
        if present:
            self.last_seen = now
            self.keyboard_changed(True)
        elif now - getattr(self, "last_seen", 0.0) >= GONE_AFTER:
            self.keyboard_changed(False)

    def watch_keyboard(self) -> None:
        self.keyboard = self.read_keyboard(self.s.keyboard)
        self.last_seen = time.monotonic()
        ticks = 0
        while True:
            time.sleep(0.5)
            ticks += 1
            try:
                self.keyboard_seen(self.read_keyboard(self.s.keyboard), time.monotonic())
                if ticks % 6 == 0:
                    self.refullscreen()
                    self.sync_power()
            except Exception as err:  # noqa: BLE001 - the watch must go on
                log.warning("Screen: %s", err)

    def sync_power(self) -> None:
        """The output woken by a key or the mouse (swayidle, see sway.conf),
        or switched off elsewhere: the state follows, and Home Assistant
        is told."""
        try:
            out = subprocess.run(["swaymsg", "-t", "get_outputs", "-r"], capture_output=True, text=True, timeout=5)
            outputs = json.loads(out.stdout or "[]")
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return
        for o in outputs if isinstance(outputs, list) else []:
            if o.get("name") != self.s.output:
                continue
            power = o.get("power", o.get("dpms"))
            if isinstance(power, bool) and power != self.on:
                self.on = power
                log.info("Screen: %s (from the session)", "on" if power else "off")
                self.publish()
            return

    def refullscreen(self) -> None:
        """Chromium back to fullscreen once no settings window is open (closed
        by « Fermer » or by its own close button): its bar never stays."""
        try:
            out = subprocess.run(["swaymsg", "-t", "get_tree", "-r"], capture_output=True, text=True, timeout=5)
            tree = json.loads(out.stdout or "{}")
        except (OSError, subprocess.TimeoutExpired, ValueError):
            return
        apps, chromium = [], []

        def walk(node: dict) -> None:
            app = node.get("app_id") or ""
            if re.match(APP_WINDOWS, app):
                apps.append(node)
            elif app.startswith("chromium"):
                chromium.append(node)
            for child in (node.get("nodes") or []) + (node.get("floating_nodes") or []):
                walk(child)

        walk(tree)
        if not apps and any(not c.get("fullscreen_mode") for c in chromium):
            self.run(["swaymsg", '[app_id="^chromium"]', "fullscreen", "enable"])

    # Home Assistant
    def publish(self) -> None:
        if not (self.url and self.token):
            return
        body = {"state": "on" if self.on else "off",
                "attributes": {"friendly_name": "Igor screen", "icon": "mdi:monitor-dashboard",
                               "keyboard": "here" if self.keyboard else "away", "output": self.s.output}}
        try:
            from .machine import post

            post(self.url, self.token, self.s.sensor, body)
        except Exception as err:  # noqa: BLE001
            log.warning("Screen: state not sent: %s", err)

    def handle(self, msg: dict) -> None:
        """One websocket message: an order, or the PC's state."""
        if msg.get("type") != "event":
            return
        event = msg.get("event") or {}
        if event.get("event_type") == self.s.event:
            data = event.get("data") or {}
            self.act(str(data.get("action", "")), data)
            return
        for entity, data in ((event.get("a") or {}) | (event.get("c") or {})).items():
            if entity != self.s.pc_entity:
                continue
            state = data.get("s") if "s" in data else (data.get("+") or {}).get("s")
            if state is not None:
                self.pc_state = str(state)

    def listen(self) -> None:
        from . import ha

        delay = 5
        while True:
            try:
                conn = ha.connect(self.url, self.token)
                conn.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": self.s.event}))
                if self.s.pc_entity:
                    conn.send(json.dumps({"id": 2, "type": "subscribe_entities", "entity_ids": [self.s.pc_entity]}))
                log.info("Screen: listening to Home Assistant's %s orders", self.s.event)
                delay = 5
                self.publish()
                for raw in conn:
                    self.handle(json.loads(raw))
            except Exception as err:  # noqa: BLE001
                log.warning("Screen: Home Assistant unreachable (%s); retrying in %ss", err, delay)
            time.sleep(delay)
            delay = min(delay * 2, 120)

    def serve(self) -> None:
        log.info("Screen: output %s, DDC bus %s, here 0x%02x, PC 0x%02x, keyboard %s",
                 self.s.output, self.bus, self.s.here, self.s.pc, self.s.keyboard or "any USB keyboard")
        if self.url and self.token:
            threading.Thread(target=self.listen, daemon=True, name="screen-ha").start()
        self.watch_keyboard()
