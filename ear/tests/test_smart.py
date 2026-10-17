"""The smart addressing mode: media silence, the request filter, the judge."""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import pytest

from igor_ear.addressing import Addressing
from igor_ear.ha import Watcher
from igor_ear.judge import Judge
from igor_ear.listener import Listener, Outcome
from igor_ear.media import audible
from igor_ear.stt import Transcript


def test_media_audible():
    assert audible("playing", {"volume_level": 0.3})
    assert audible("on", {})
    assert not audible("playing", {"is_volume_muted": True})
    assert not audible("playing", {"volume_level": 0})
    assert not audible("paused", {"volume_level": 0.5})
    assert not audible("off", None)
    assert not audible(None)


@pytest.mark.parametrize("text,expected", [
    ("Éteins la lumière du salon", True),
    ("Il fait combien dehors ?", True),
    ("Quelle heure est-il", True),
    ("la lumière de la cuisine s'il te plaît", False),
    ("Vers sept heures, ferme la porte à clé en partant.", False),
    ("Rappelle-moi d'appeler maman demain", True),
    ("Hier on est allés au marché avec les enfants", False),
    ("Sous-titres réalisés par la communauté d'Amara.org", False),
])
def test_looks_like_request(text, expected):
    assert Addressing().looks_like_request(text) is expected


def test_watcher_keeps_attributes():
    w = Watcher("http://x", "t", ["media_player.tv"])
    w.apply({"event": {"a": {"media_player.tv": {"s": "playing", "a": {"volume_level": 0.4, "is_volume_muted": False}}}}})
    assert audible(w.state("media_player.tv"), w.attributes("media_player.tv"))
    w.apply({"event": {"c": {"media_player.tv": {"+": {"a": {"is_volume_muted": True}}}}}})
    assert not audible(w.state("media_player.tv"), w.attributes("media_player.tv"))
    w.apply({"event": {"c": {"media_player.tv": {"+": {"s": "paused"}, "-": {"a": ["is_volume_muted"]}}}}})
    assert w.state("media_player.tv") == "paused" and "is_volume_muted" not in w.attributes("media_player.tv")


# --- the judge, against a fake Ollama ---------------------------------------
answer = {"content": '{"pour_igor": true}'}
asked = {}


class FakeOllama(BaseHTTPRequestHandler):
    def do_POST(self):
        asked["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        asked["path"] = self.path
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps({"message": answer}).encode())

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def ollama():
    server = HTTPServer(("127.0.0.1", 0), FakeOllama)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def test_judge_says_yes_and_sees_the_context(ollama):
    answer["content"] = '{"pour_igor": true}'
    judge = Judge(ollama, "qwen2.5:1.5b")
    assert judge([(12.0, "il fait sombre ici")], "allume la lumière") is True
    body = asked["body"]
    assert asked["path"] == "/api/chat" and body["model"] == "qwen2.5:1.5b" and body["format"] == "json"
    assert "il fait sombre ici" in body["messages"][1]["content"]
    assert "allume la lumière" in body["messages"][1]["content"]


def test_judge_says_no_or_nonsense(ollama):
    judge = Judge(ollama, "m")
    answer["content"] = '{"pour_igor": false}'
    assert judge([], "allume la lumière") is False
    answer["content"] = "peut-être"
    assert judge([], "allume la lumière") is None


def test_judge_unreachable_is_none():
    assert Judge("http://127.0.0.1:9", "m", timeout=1)([], "allume la lumière") is None


# --- the listener in smart mode ---------------------------------------------
class Clock:
    t = 0.0

    def __call__(self):
        return self.t


def smart(texts, verdict=True, acts=True, allowed=True):
    clock, heard, sent, seen = Clock(), iter(texts), [], []

    def stt(a):
        return Transcript(next(heard), 0.3, 0.1, -0.2)

    def do(a, conversation):
        sent.append(conversation)
        return Outcome(speech="Fait.")

    def judge(context, text):
        seen.append((context, text))
        return verdict

    listener = Listener(stt, Addressing(), do, clock=clock, judge=judge,
                        judge_allowed=lambda: allowed, judge_acts=acts)
    return listener, clock, sent, seen


def audio():
    return np.zeros(16000, dtype=np.float32)


def test_smart_yes_acts_with_the_context():
    listener, clock, sent, seen = smart(["il fait vraiment sombre", "allume la lumière du salon"])
    listener.handle(audio())
    clock.t = 5
    e = listener.handle(audio())
    assert e["accepted"] and e["reason"] == "smart" and e["sent"] and sent == [None]
    assert seen == [([(5.0, "il fait vraiment sombre")], "allume la lumière du salon")]


def test_smart_noted_only_until_switched_on():
    listener, _, sent, _ = smart(["allume la lumière du salon"], acts=False)
    e = listener.handle(audio())
    assert not e["accepted"] and e["reason"] == "smart_would_act" and sent == []


def test_smart_no_and_not_a_request():
    listener, _, sent, seen = smart(["allume la lumière du salon", "on a bien mangé hier"], verdict=False)
    assert listener.handle(audio())["reason"] == "judged_not_for_igor"
    assert listener.handle(audio())["reason"] == "not_addressed"   # never shown to the judge
    assert sent == [] and len(seen) == 1


def test_smart_waits_while_the_television_sounds():
    listener, _, sent, seen = smart(["allume la lumière du salon", "Igor, allume la lumière"], allowed=False)
    assert listener.handle(audio())["reason"] == "media_playing"
    assert listener.handle(audio())["reason"] == "name"            # the name still works
    assert seen == [] and sent == [None]
