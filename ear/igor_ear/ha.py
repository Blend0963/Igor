"""Home Assistant, over its websocket API.

Two things only:
- watch a few entities (the satellite, the presence entity) to know whether
  linux-voice-assistant is busy and whether anyone is home;
- run the Assist pipeline from speech: the recorded sentence goes to the
  pipeline's own speech-to-text (Voxtral, through Igor) and on to Igor, and
  the answer comes back as text. The satellite then says it.

A long-lived access token (Profile > Security) is the only credential.
"""
from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

log = logging.getLogger("igor-ear")

AUDIO_CHUNK = 8192  # bytes per binary websocket message (0.25 s of 16 kHz int16)


def ws_url(url: str) -> str:
    base = url.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base[len("https://"):] + "/api/websocket"
    if base.startswith("http://"):
        return "ws://" + base[len("http://"):] + "/api/websocket"
    return base + "/api/websocket"


def connect(url: str, token: str, timeout: float = 10):
    """An authenticated websocket connection."""
    from websockets.sync.client import connect as ws_connect

    conn = ws_connect(ws_url(url), open_timeout=timeout, max_size=None)
    first = json.loads(conn.recv(timeout=timeout))
    if first.get("type") != "auth_required":
        conn.close()
        raise RuntimeError(f"Unexpected greeting: {first}")
    conn.send(json.dumps({"type": "auth", "access_token": token}))
    reply = json.loads(conn.recv(timeout=timeout))
    if reply.get("type") != "auth_ok":
        conn.close()
        raise PermissionError("Home Assistant refused the token")
    return conn


@dataclass
class PipelineResult:
    heard: str = ""
    speech: str = ""
    conversation_id: str | None = None
    continue_conversation: bool = False
    error: str = ""


def run_pipeline(
    url: str,
    token: str,
    pcm16: bytes,
    pipeline: str | None = None,
    conversation_id: str | None = None,
    device_id: str | None = None,
    timeout: float = 90,
) -> PipelineResult:
    """Speech in, Igor's answer out (as text; the satellite speaks it)."""
    result = PipelineResult()
    conn = connect(url, token)
    try:
        request: dict[str, Any] = {
            "id": 1,
            "type": "assist_pipeline/run",
            "start_stage": "stt",
            "end_stage": "intent",
            # The sentence is already cut, pauses included: the pipeline must
            # not end it at the first silence of its own.
            "input": {"sample_rate": 16000, "no_vad": True},
            "timeout": 60,
        }
        if pipeline:
            request["pipeline"] = pipeline
        if conversation_id:
            request["conversation_id"] = conversation_id
        if device_id:
            # Asked in the satellite's name: Igor answers in its spoken style
            # and the wall tablet shows the exchange.
            request["device_id"] = device_id
        conn.send(json.dumps(request))
        deadline = time.monotonic() + timeout
        sent = False
        while time.monotonic() < deadline:
            msg = json.loads(conn.recv(timeout=max(1.0, deadline - time.monotonic())))
            if msg.get("type") == "result":
                if not msg.get("success", False):
                    result.error = str(msg.get("error", {}).get("message", "pipeline refused"))
                    return result
                continue
            if msg.get("type") != "event":
                continue
            event = msg.get("event", {})
            kind, data = event.get("type"), event.get("data") or {}
            if kind == "run-start" and not sent:
                handler = (data.get("runner_data") or {}).get("stt_binary_handler_id")
                if handler is None:
                    result.error = "pipeline does not take audio"
                    return result
                prefix = bytes([handler])
                for i in range(0, len(pcm16), AUDIO_CHUNK):
                    conn.send(prefix + pcm16[i:i + AUDIO_CHUNK])
                conn.send(prefix)  # end of audio
                sent = True
            elif kind == "stt-end":
                result.heard = str((data.get("stt_output") or {}).get("text", ""))
            elif kind == "intent-end":
                output = data.get("intent_output") or {}
                response = output.get("response") or {}
                result.speech = str(((response.get("speech") or {}).get("plain") or {}).get("speech", ""))
                result.conversation_id = output.get("conversation_id") or result.conversation_id
                result.continue_conversation = bool(output.get("continue_conversation", False))
            elif kind == "error":
                result.error = f"{data.get('code', 'error')}: {data.get('message', '')}"
            elif kind == "run-end":
                return result
        result.error = result.error or "timeout"
        return result
    finally:
        conn.close()


def announce(url: str, token: str, satellite: str, message: str, timeout: float = 30) -> None:
    """Have the satellite say Igor's answer, with its own voice and speaker."""
    body = json.dumps({"entity_id": satellite, "message": message, "preannounce": False}).encode()
    request = urllib.request.Request(
        url.rstrip("/") + "/api/services/assist_satellite/announce",
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout):
        pass


class Watcher:
    """Live states of a few entities, kept up to date in a background thread."""

    def __init__(self, url: str, token: str, entities: list[str], on_change: Callable[[str, str], None] | None = None):
        self.url, self.token = url, token
        self.entities = [e for e in entities if e]
        self.states: dict[str, str] = {}
        self.connected = False
        self._on_change = on_change
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        if self.entities:
            self._thread.start()

    def state(self, entity: str) -> str | None:
        return self.states.get(entity)

    def apply(self, message: dict) -> None:
        """Apply one subscribe_entities event ({'a': added, 'c': changed, 'r': removed})."""
        event = message.get("event") or {}
        for entity, data in (event.get("a") or {}).items():
            self._set(entity, str(data.get("s", "")))
        for entity, data in (event.get("c") or {}).items():
            plus = data.get("+") or {}
            if "s" in plus:
                self._set(entity, str(plus["s"]))
        for entity in event.get("r") or []:
            self.states.pop(entity, None)

    def _set(self, entity: str, state: str) -> None:
        if self.states.get(entity) != state:
            self.states[entity] = state
            if self._on_change:
                self._on_change(entity, state)

    def _loop(self) -> None:
        delay = 5
        while True:
            try:
                conn = connect(self.url, self.token)
                conn.send(json.dumps({"id": 1, "type": "subscribe_entities", "entity_ids": self.entities}))
                self.connected = True
                delay = 5
                log.info("Home Assistant: watching %s", ", ".join(self.entities))
                for raw in conn:
                    msg = json.loads(raw)
                    if msg.get("type") == "event":
                        self.apply(msg)
                    elif msg.get("type") == "result" and not msg.get("success", True):
                        log.warning("Home Assistant refused the subscription: %s", msg.get("error"))
            except Exception as err:  # noqa: BLE001
                log.warning("Home Assistant unreachable (%s); retrying in %ss", err, delay)
            self.connected = False
            self.states.clear()
            time.sleep(delay)
            delay = min(delay * 2, 120)


def device_of(url: str, token: str, entity: str) -> str | None:
    """The device an entity belongs to (the satellite's, to speak in its name)."""
    conn = connect(url, token)
    try:
        conn.send(json.dumps({"id": 1, "type": "config/entity_registry/get", "entity_id": entity}))
        while True:
            msg = json.loads(conn.recv(timeout=10))
            if msg.get("id") == 1:
                return (msg.get("result") or {}).get("device_id") if msg.get("success") else None
    finally:
        conn.close()
