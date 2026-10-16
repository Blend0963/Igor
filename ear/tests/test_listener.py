import numpy as np

from mado_ear.addressing import Addressing
from mado_ear.listener import Listener, Outcome
from mado_ear.stt import Transcript


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def make(texts, act=True, busy=lambda: False):
    clock = Clock()
    heard = iter(texts)
    sent = []

    def stt(audio):
        return Transcript(next(heard), 0.3, 0.1, -0.2)

    def do(audio, conversation):
        sent.append((len(audio), conversation))
        question = len(sent) == 1
        return Outcome(heard="(voxtral)", speech="D'accord ?" if question else "Fait.",
                       conversation_id="c1", continue_conversation=question)

    listener = Listener(stt, Addressing(), do if act else None, busy=busy, clock=clock)
    return listener, clock, sent


def audio(seconds=1.0):
    return np.zeros(int(16000 * seconds), dtype=np.float32)


def test_name_in_sentence_is_sent():
    listener, _, sent = make(["Éteins la lumière Madou"])
    e = listener.handle(audio())
    assert e["accepted"] and e["reason"] == "name" and e["sent"]
    assert sent == [(16000, None)]


def test_no_name_is_ignored_and_not_sent():
    listener, _, sent = make(["Éteins la lumière"])
    assert not listener.handle(audio())["accepted"]
    assert sent == []


def test_name_alone_then_order_sent_together():
    listener, clock, sent = make(["MaDo ?", "éteins la cuisine"])
    assert listener.handle(audio(0.5))["reason"] == "name_alone_waiting"
    clock.t = 3
    e = listener.handle(audio(1.5))
    assert e["reason"] == "after_name"
    assert sent == [(8000 + 3200 + 24000, None)]


def test_name_alone_expires():
    listener, clock, sent = make(["MaDo", "éteins la cuisine"])
    listener.handle(audio())
    clock.t = 20
    assert not listener.handle(audio())["accepted"]
    assert sent == []


def test_followup_after_a_question_keeps_the_conversation():
    listener, clock, sent = make(["MaDo baisse les volets", "oui le salon", "et la cuisine"])
    listener.handle(audio())          # MaDo answers with a question
    clock.t = 3
    e = listener.handle(audio())      # answered without the name
    assert e["reason"] == "followup" and sent[1][1] == "c1"
    clock.t = 5
    assert not listener.handle(audio())["accepted"]  # the second answer closed the window


def test_satellite_busy_skips_everything():
    listener, _, sent = make([], busy=lambda: True)
    assert listener.handle(audio())["reason"] == "satellite_busy"
    assert sent == []


def test_observation_mode_never_acts():
    listener, _, _ = make(["MaDo éteins tout"], act=False)
    e = listener.handle(audio())
    assert e["accepted"] and "sent" not in e
