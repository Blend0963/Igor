"""Transcription through a whisper.cpp server, against a fake one."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np

from igor_ear.stt import Transcriber

REPLY = {
    "text": " Igor, quelle heure est-il ?",
    "segments": [{
        "text": " Igor, quelle heure est-il ?", "start": 0.0, "end": 2.0,
        "no_speech_prob": 0.05, "avg_logprob": -0.3,
        "words": [{"word": " Igor", "start": 0.1, "end": 0.5}, {"word": ",", "start": 0.5, "end": 0.5},
                  {"word": " quelle", "start": 0.6, "end": 0.9}],
    }],
}
requests = []


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        requests.append((self.path, self.headers["Content-Type"], body))
        data = json.dumps(REPLY).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def test_server_transcription_gives_text_scores_and_timed_words():
    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        stt = Transcriber(language="fr", hotwords="Igor", server_url=f"http://127.0.0.1:{server.server_port}")
        assert stt.device == "whisper.cpp" and stt.full
        heard = stt(np.zeros(16000, dtype=np.float32))
    finally:
        server.shutdown()
    assert heard.text == "Igor, quelle heure est-il ?"
    assert heard.no_speech == 0.05 and heard.logprob == -0.3
    start, end, text, words = heard.parts[0]
    assert (start, end) == (0.0, 2.0) and [x["word"] for x in words] == [" Igor", ",", " quelle"]
    path, content_type, body = requests[-1]
    assert path == "/inference" and content_type.startswith("multipart/form-data")
    assert b'name="prompt"' in body and b"Igor" in body and b"RIFF" in body   # the hotword, and a wav
