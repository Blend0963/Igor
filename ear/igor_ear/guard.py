"""The desk screen's guard: locked while the key is away, an alert while the
alarm goes off. Not a page of the dashboard: a window of its own.

- A small web server on 127.0.0.1 only serves the guard's page (the camera,
  the keypad) and passes the code to Home Assistant's `nives.disarm`, which
  checks it (the code is never stored here, the token never reaches the page).
- igor-screen opens that page in its own Chromium window (`--app`), keeps it
  fullscreen and focused above the dashboard, and turns off the kiosk's exit
  shortcut while it is up.
- If that window cannot be shown, swaylock locks the session instead: a real
  screen locker, nothing behind it.

Locked: the key entity is anything but "on" (off, unavailable, unknown).
Alert: the alarm entity is "on". The alert comes before the lock.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

log = logging.getLogger("igor-ear")

PORT = 8771
TITLE = "IGOR · GARDE"
PAGE = Path(__file__).with_name("guard.html")


def mode_of(key_state: str | None, alarm_state: str | None, key_entity: str, alarm_entity: str) -> str:
    """« alarm », « lock » or « » (nothing to show)."""
    if alarm_entity and alarm_state == "on":
        return "alarm"
    if key_entity and key_state != "on":
        return "lock"
    return ""


class Guard:
    def __init__(self, key_entity: str, alarm_entity: str, camera: str, ha_url: str, ha_token: str,
                 runner=None) -> None:
        self.key_entity, self.alarm_entity, self.camera = key_entity, alarm_entity, camera
        self.url, self.token = ha_url.rstrip("/"), ha_token
        self.key_state: str | None = None
        self.alarm_state: str | None = None
        self.mode = ""
        self.since = 0.0
        self.proc: subprocess.Popen | None = None
        self.swaylock: subprocess.Popen | None = None
        self.shown_at = 0.0
        self.run = runner or (lambda cmd: subprocess.run(cmd, capture_output=True, timeout=5))
        self.lock = threading.Lock()

    @property
    def enabled(self) -> bool:
        return bool(self.key_entity or self.alarm_entity)

    def entities(self) -> list[str]:
        return [e for e in (self.key_entity, self.alarm_entity) if e]

    # ----- states from Home Assistant -----
    def state(self, entity: str, value: str | None) -> None:
        with self.lock:
            if entity == self.key_entity:
                self.key_state = value
            if entity == self.alarm_entity:
                self.alarm_state = value
            new = mode_of(self.key_state, self.alarm_state, self.key_entity, self.alarm_entity)
            if new != self.mode:
                log.info("Guard: %s", new or "clear")
                self.mode, self.since = new, time.time()

    # ----- the window -----
    def tick(self) -> None:
        """Called every second by igor-screen: the window up or down."""
        if self.mode:
            self.show()
        else:
            self.hide()

    def show(self) -> None:
        if self.swaylock and self.swaylock.poll() is None:
            return
        if self.proc is None or self.proc.poll() is not None:
            self.run(["swaymsg", "unbindsym", "Ctrl+Mod1+BackSpace"])
            self.run(["swaymsg", "output", "*", "power", "on"])
            try:
                self.proc = subprocess.Popen(
                    ["chromium", "--ozone-platform=wayland", f"--app=http://127.0.0.1:{PORT}/",
                     f"--user-data-dir={Path.home() / '.cache/igor-guard'}", "--no-first-run",
                     "--noerrdialogs", "--disable-translate", "--start-fullscreen"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.shown_at = time.monotonic()
            except OSError as err:
                log.warning("Guard: no window (%s); swaylock instead", err)
                self.fallback()
                return
        # Above everything, fullscreen, focused; it took too long: lock instead.
        r = self.run(["swaymsg", f'[title="^{TITLE}"] fullscreen enable, focus'])
        if getattr(r, "returncode", 0) != 0 and time.monotonic() - self.shown_at > 15:
            log.warning("Guard: the window did not show; swaylock instead")
            self.fallback()

    def fallback(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        try:
            self.swaylock = subprocess.Popen(["swaylock", "--color", "050607"],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError as err:
            log.warning("Guard: swaylock unavailable: %s", err)

    def hide(self) -> None:
        was_up = (self.proc and self.proc.poll() is None) or (self.swaylock and self.swaylock.poll() is None)
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        if self.swaylock and self.swaylock.poll() is None:
            self.swaylock.terminate()
        self.proc = self.swaylock = None
        if was_up:
            self.run(["swaymsg", "bindsym", "Ctrl+Mod1+BackSpace", "exit"])

    # ----- what the page asks for -----
    def ha(self, method: str, path: str, body: dict | None = None, timeout: float = 10):
        req = urllib.request.Request(self.url + path, method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        return urllib.request.urlopen(req, timeout=timeout)

    def disarm(self, code: str) -> dict:
        try:
            with self.ha("POST", "/api/services/nives/disarm?return_response", {"code": code}) as r:
                data = json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as err:
            return {"ok": False, "message": f"Home Assistant : erreur {err.code}"}
        except (urllib.error.URLError, TimeoutError, ValueError) as err:
            return {"ok": False, "message": f"Home Assistant injoignable ({err})"}
        resp = data.get("service_response") if isinstance(data, dict) else None
        return resp if isinstance(resp, dict) else {"ok": False, "message": "Réponse inattendue"}

    def camera_jpeg(self) -> bytes | None:
        if not self.camera:
            return None
        try:
            with self.ha("GET", f"/api/camera_proxy/{self.camera}", timeout=8) as r:
                return r.read(8_000_000)
        except (urllib.error.URLError, TimeoutError):
            return None

    def serve(self) -> None:
        guard = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args) -> None:
                pass

            def send(self, code: int, body: bytes, kind: str) -> None:
                self.send_response(code)
                self.send_header("Content-Type", kind)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:
                if self.path in ("/", "/index.html"):
                    self.send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
                elif self.path.startswith("/state"):
                    body = {"mode": guard.mode, "since": guard.since, "camera": bool(guard.camera),
                            "alarm": guard.alarm_entity}
                    self.send(200, json.dumps(body).encode(), "application/json")
                elif self.path.startswith("/camera.jpg"):
                    img = guard.camera_jpeg()
                    self.send(200 if img else 404, img or b"", "image/jpeg")
                else:
                    self.send(404, b"", "text/plain")

            def do_POST(self) -> None:
                if self.path != "/disarm":
                    self.send(404, b"", "text/plain")
                    return
                try:
                    length = min(int(self.headers.get("Content-Length") or 0), 256)
                    code = str(json.loads(self.rfile.read(length) or b"{}").get("code", ""))[:32]
                except (ValueError, AttributeError):
                    code = ""
                body = guard.disarm(code) if code else {"ok": False, "message": "Code vide"}
                self.send(200, json.dumps(body).encode(), "application/json")

        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
        threading.Thread(target=server.serve_forever, daemon=True, name="guard-http").start()
        log.info("Guard: key %s, alarm %s, camera %s", self.key_entity or "—", self.alarm_entity or "—", self.camera or "—")
