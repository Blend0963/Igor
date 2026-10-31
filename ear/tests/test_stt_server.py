import io
import json
import threading
import wave
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np

from igor_ear.stt import Transcriber, read_server


def test_read_server_takes_the_worst_segment():
    reply = {"text": " Igor, allume le salon.", "segments": [
        {"text": " Igor,", "no_speech_prob": 0.1, "avg_logprob": -0.2},
        {"text": " allume le salon.", "no_speech_prob": 0.3, "avg_logprob": -0.5},
    ]}
    assert read_server(reply) == ("Igor, allume le salon.", 0.3, -0.5)


def test_read_server_without_segments_is_speech_when_there_is_text():
    assert read_server({"text": "Igor"}) == ("Igor", 0.0, 0.0)
    assert read_server({"text": ""}) == ("", 1.0, 0.0)


def serve(reply, seen):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            seen.append((self.path, body))
            data = json.dumps(reply).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def test_transcriber_uses_whisper_server():
    seen = []
    server = serve({"text": "Igor, éteins la lumière", "segments": [
        {"text": "Igor, éteins la lumière", "no_speech_prob": 0.05, "avg_logprob": -0.3}]}, seen)
    try:
        stt = Transcriber(language="fr", hotwords="Igor", server=f"http://127.0.0.1:{server.server_port}")
        heard = stt(np.full(16000, 0.1, dtype=np.float32))
    finally:
        server.shutdown()
    assert stt.device.startswith("whisper-server")
    assert (heard.text, heard.no_speech, heard.logprob) == ("Igor, éteins la lumière", 0.05, -0.3)
    path, body = seen[-1]
    assert path == "/inference"
    assert b'name="language"\r\n\r\nfr' in body and b'name="prompt"\r\n\r\nIgor' in body
    wav = body[body.index(b"RIFF"):]
    with wave.open(io.BytesIO(wav)) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (16000, 1, 2)


def test_a_failing_server_loses_the_sentence_not_the_service():
    seen = []
    server = serve({"text": ""}, seen)
    url = f"http://127.0.0.1:{server.server_port}"
    stt = Transcriber(language="fr", server=url)
    server.shutdown()
    server.server_close()
    heard = stt(np.zeros(16000, dtype=np.float32))
    assert heard.text == "" and heard.no_speech == 1.0
