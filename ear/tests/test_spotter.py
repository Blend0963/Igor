import numpy as np

from igor_ear.addressing import Addressing
from igor_ear.listener import Listener, Outcome
from igor_ear.spotter import Spot, read
from igor_ear.stt import Transcript


def words(*pairs):
    return {"result": [{"word": w, "conf": c, "start": 0, "end": 0} for w, c in pairs]}


def test_read_a_vosk_result():
    spot = read(words(("[unk]", 1.0), ("[unk]", 1.0), ("mado", 0.9)), {"mado"})
    assert spot.found and not spot.alone and spot.last and not spot.first
    assert read(words(("mado", 0.95)), {"mado"}).alone
    assert not read(words(("mado", 0.3)), {"mado"}).found          # unsure
    assert not read({"text": ""}, {"mado"}).found
    assert read({"text": "igor"}, {"igor"}).alone                  # without SetWords


def make(texts, spots, names=("igor",)):
    heard = iter(texts)
    spotted = iter(spots)
    sent = []

    def act(a, c):
        sent.append(len(a))
        return Outcome(speech="Fait.")

    listener = Listener(lambda a: next(heard), Addressing(names=list(names)), act,
                        clock=lambda: 0.0, spotter=lambda a: next(spotted))
    return listener, sent


def t(text, no_speech=0.1, logprob=-0.2):
    return Transcript(text, 0.3, no_speech, logprob)


def test_whisper_missed_the_name_vosk_heard_it():
    listener, sent = make([t("Hector, allume la lumière")], [Spot(["igor"], 3, first=True)])
    e = listener.handle(np.zeros(16000, dtype=np.float32))
    assert e["sent"] and e["reason"] == "name" and e["vosk_only"]


def test_the_name_alone_heard_by_vosk_only():
    listener, sent = make([t("Ma dot.", no_speech=0.95)], [Spot(["mado"], 0, True, True)], names=["mado"])
    e = listener.handle(np.zeros(16000, dtype=np.float32))
    assert e["reason"] == "name_alone_waiting" and e["vosk"] == "mado"


def test_no_name_for_either_is_not_for_igor():
    listener, sent = make([t("Hector est passé hier")], [Spot([], 4)])
    e = listener.handle(np.zeros(16000, dtype=np.float32))
    assert e["reason"] == "not_addressed" and not sent


def test_a_broken_spotter_leaves_whisper_alone():
    def broken(a):
        raise RuntimeError("no model")
    listener = Listener(lambda a: t("Igor, allume la lumière"), Addressing(), lambda a, c: Outcome(speech="Fait."),
                        clock=lambda: 0.0, spotter=broken)
    e = listener.handle(np.zeros(16000, dtype=np.float32))
    assert e["sent"] and e["vosk_error"] == "no model"


def test_other_names():
    rules = Addressing(names=["mado"])
    assert rules.decide("Mado, éteins la lumière").reason == "name"
    assert rules.decide("éteins la lumière madeau").reason == "name"
    assert rules.decide("Igor, éteins la lumière").reason == "not_addressed"
    assert rules.decide("Madi, éteins la lumière").reason == "near_name"
    assert rules.name_only("Mado ?")
    both = Addressing(names=["igor", "mado"])
    assert both.decide("Igor, éteins").accepted and both.decide("Mado, éteins").accepted


def test_settings_names(tmp_path):
    from igor_ear.config import load

    f = tmp_path / "c.toml"
    f.write_text('[stt]\nhotwords = "Igor"\n[name]\nnames = ["Mado"]\n')
    s = load(f)
    assert s.names == ["mado"] and s.hotwords == "Mado" and s.spotter == "vosk"
    f.write_text('[name]\nspotter = "off"\n')
    assert load(f).spotter == "off" and load(f).hotwords == "Igor"
