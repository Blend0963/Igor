"""The Home Assistant client against a fake server speaking the same protocol."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

websockets = pytest.importorskip("websockets")
from websockets.sync.server import serve  # noqa: E402

from igor_ear import ha  # noqa: E402

TOKEN = "secret"
received = {"audio": b"", "run": None, "announce": None}


def handler(ws):
    ws.send(json.dumps({"type": "auth_required"}))
    auth = json.loads(ws.recv())
    if auth.get("access_token") != TOKEN:
        ws.send(json.dumps({"type": "auth_invalid"}))
        return
    ws.send(json.dumps({"type": "auth_ok"}))
    for raw in ws:
        if isinstance(raw, bytes):
            if raw[0] != 7:
                raise AssertionError("wrong handler id")
            if len(raw) == 1:  # end of audio
                for event in [
                    {"type": "stt-start", "data": {}},
                    {"type": "stt-end", "data": {"stt_output": {"text": "Igor éteins la lumière"}}},
                    {"type": "intent-end", "data": {"intent_output": {
                        "conversation_id": "conv-9", "continue_conversation": True,
                        "response": {"speech": {"plain": {"speech": "C'est fait. Autre chose ?"}}}}}},
                    {"type": "run-end", "data": None},
                ]:
                    ws.send(json.dumps({"id": 1, "type": "event", "event": event}))
            else:
                received["audio"] += raw[1:]
            continue
        msg = json.loads(raw)
        if msg["type"] == "assist_pipeline/run":
            received["run"] = msg
            ws.send(json.dumps({"id": msg["id"], "type": "result", "success": True, "result": None}))
            ws.send(json.dumps({"id": msg["id"], "type": "event", "event": {
                "type": "run-start", "data": {"runner_data": {"stt_binary_handler_id": 7}}}}))
        elif msg["type"] == "subscribe_entities":
            ws.send(json.dumps({"id": msg["id"], "type": "result", "success": True, "result": None}))
            ws.send(json.dumps({"id": msg["id"], "type": "event", "event": {
                "a": {"assist_satellite.vm": {"s": "idle", "a": {}}, "binary_sensor.presence": {"s": "on", "a": {}}}}}))
            time.sleep(0.2)
            ws.send(json.dumps({"id": msg["id"], "type": "event", "event": {
                "c": {"assist_satellite.vm": {"+": {"s": "responding"}}}}}))
            time.sleep(5)
        elif msg["type"] == "config/entity_registry/get":
            ws.send(json.dumps({"id": msg["id"], "type": "result", "success": True,
                                "result": {"entity_id": msg["entity_id"], "device_id": "dev-42"}}))


class Rest(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        received["announce"] = (self.path, self.headers["Authorization"], json.loads(body))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"[]")

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def server():
    with serve(handler, "127.0.0.1", 0) as ws_server:
        port = ws_server.socket.getsockname()[1]
        threading.Thread(target=ws_server.serve_forever, daemon=True).start()
        http = HTTPServer(("127.0.0.1", 0), Rest)
        threading.Thread(target=http.serve_forever, daemon=True).start()
        yield f"http://127.0.0.1:{port}", f"http://127.0.0.1:{http.server_address[1]}"
        http.shutdown()
        ws_server.shutdown()


def test_bad_token(server):
    with pytest.raises(PermissionError):
        ha.connect(server[0], "wrong")


def test_pipeline_sends_audio_and_reads_answer(server):
    pcm = bytes(range(256)) * 100  # 25600 bytes: four chunks
    r = ha.run_pipeline(server[0], TOKEN, pcm, pipeline="p1", conversation_id="c0", device_id="dev-42")
    assert received["audio"] == pcm
    run = received["run"]
    assert run["start_stage"] == "stt" and run["end_stage"] == "intent"
    assert run["input"] == {"sample_rate": 16000, "no_vad": True}
    assert run["device_id"] == "dev-42" and run["pipeline"] == "p1" and run["conversation_id"] == "c0"
    assert r.heard == "Igor éteins la lumière"
    assert r.speech == "C'est fait. Autre chose ?"
    assert r.conversation_id == "conv-9" and r.continue_conversation and not r.error


def test_device_of(server):
    assert ha.device_of(server[0], TOKEN, "assist_satellite.vm") == "dev-42"


def test_watcher(server):
    seen = []
    w = ha.Watcher(server[0], TOKEN, ["assist_satellite.vm", "binary_sensor.presence"], lambda e, s: seen.append((e, s)))
    w.start()
    deadline = time.time() + 3
    while time.time() < deadline and w.state("assist_satellite.vm") != "responding":
        time.sleep(0.05)
    assert w.state("assist_satellite.vm") == "responding"
    assert w.state("binary_sensor.presence") == "on"
    assert ("assist_satellite.vm", "idle") in seen


def test_announce(server):
    ha.announce(server[1], TOKEN, "assist_satellite.vm", "C'est fait.")
    path, auth, body = received["announce"]
    assert path == "/api/services/assist_satellite/announce" and auth == "Bearer secret"
    assert body == {"entity_id": "assist_satellite.vm", "message": "C'est fait.", "preannounce": False}


def test_ws_url():
    assert ha.ws_url("https://ha.local:8123/") == "wss://ha.local:8123/api/websocket"
    assert ha.ws_url("http://10.0.0.2:8123") == "ws://10.0.0.2:8123/api/websocket"
