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


def test_speech_going_on_after_a_pause_is_joined():
    listener, _, sent = make(["MaDo donne-moi les nouvelles"])
    parts = [audio(4), audio(3)]
    e = listener.handle(audio(2), more=lambda: parts.pop(0) if parts else None)
    assert e["joined"] == 2
    assert sent[0][0] == 16000 * (2 + 4 + 3) + 2 * 3200


def test_long_speech_only_head_and_tail_transcribed():
    lengths = []

    def stt(a):
        lengths.append(len(a))
        return Transcript("bla" if len(lengths) == 1 else "merci MaDo", 0.5, 0.1, -0.2)

    listener = Listener(stt, Addressing(), None)
    e = listener.handle(audio(40))
    assert lengths == [8 * 16000, 6 * 16000]
    assert e["accepted"] and e["reason"] == "name"


def test_doubtful_transcription_with_the_name_is_kept():
    def stt(a):
        return Transcript("tu montons ma doux", 0.2, 0.3, -1.4)
    e = Listener(stt, Addressing(), None).handle(audio())
    assert e["accepted"] and e["reason"] == "name"


def test_doubtful_transcription_without_the_name_is_noise():
    def stt(a):
        return Transcript("va plutôt ta blètre", 0.2, 0.3, -1.4)
    assert Listener(stt, Addressing(), None).handle(audio())["reason"] == "noise"
