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


# --- the speakers' watch -----------------------------------------------------
from igor_ear.speakers import Speakers, level_db, parse_mute, parse_volume  # noqa: E402


def test_level_db():
    assert level_db(np.zeros(800, dtype=np.int16)) == float("-inf")
    loud = (np.sin(np.linspace(0, 200, 2000)) * 16000).astype(np.int16)
    assert -10 < level_db(loud) < -8
    assert level_db(np.full(800, 3, dtype=np.int16)) < -70      # dither: silence


def test_pactl_parsing():
    assert parse_mute("Mute: yes\n") is True and parse_mute("Mute: no") is False and parse_mute("") is None
    v = "Volume: front-left: 42598 /  65% / -11.23 dB,   front-right: 45875 /  70% / -9.30 dB\n"
    assert parse_volume(v) == 70 and parse_volume("") is None


def test_speakers_sound_hold_mute_and_unknown():
    clock = Clock()
    sp = Speakers(quiet_db=-50, hold=3, clock=clock)
    assert sp.sounding() is True and sp.sounding(unknown=False) is False   # monitor not read yet
    sp.listening = True
    sp.feed(-75)
    assert not sp.sounding()                                               # quiet
    sp.feed(-22)
    clock.t = 2
    sp.feed(-80)
    assert sp.sounding()                                                   # a pause in the film
    clock.t = 3.5
    assert not sp.sounding()                                               # silence for 3 s
    clock.t = 4
    sp.feed(-20)
    sp.muted = True
    assert not sp.sounding()                                               # muted output
    sp.muted, sp.volume = False, 0
    assert not sp.sounding()                                               # volume at 0


# --- [media] in either mode --------------------------------------------------
def test_media_settings_in_their_own_section_and_the_old_place(tmp_path):
    from igor_ear.config import load
    f = tmp_path / "c.toml"
    f.write_text('[mode]\naddressing = "name"\n[media]\nwhen_media = "closed"\nsound_from = "both"\n'
                 'media_players = ["media_player.nvidia_shield"]\nquiet_db = -55\n')
    s = load(f)
    assert (s.addressing, s.when_media, s.sound_from, s.quiet_db) == ("name", "closed", "both", -55.0)
    assert s.media_players == ["media_player.nvidia_shield"]
    f.write_text('[smart]\nwhen_media = "closed"\nquiet_db = -60\n')          # 0.11.2 settings file
    s = load(f)
    assert s.when_media == "closed" and s.quiet_db == -60.0


def test_the_listener_says_when_it_waits_for_words():
    clock, heard = Clock(), iter(["Igor", "Igor, ferme les volets"])

    def do(a, conversation):
        return Outcome(speech="Tous ?", conversation_id="c", continue_conversation=True)

    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(), do, clock=clock)
    assert not listener.waiting()
    listener.handle(audio())                 # the name alone
    assert listener.waiting()
    clock.t = 10
    assert not listener.waiting()            # gave up on the order
    listener.handle(audio())                 # Igor asks back
    assert listener.waiting()
