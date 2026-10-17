import numpy as np

from igor_ear.addressing import Addressing
from igor_ear.listener import Listener, Outcome
from igor_ear.stt import Transcript


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
    listener, _, sent = make(["Éteins la lumière Igor"])
    e = listener.handle(audio())
    assert e["accepted"] and e["reason"] == "name" and e["sent"]
    assert sent == [(16000, None)]


def test_no_name_is_ignored_and_not_sent():
    listener, _, sent = make(["Éteins la lumière"])
    assert not listener.handle(audio())["accepted"]
    assert sent == []


def test_name_alone_then_order_sent_together():
    listener, clock, sent = make(["Igor ?", "éteins la cuisine"])
    assert listener.handle(audio(0.5))["reason"] == "name_alone_waiting"
    clock.t = 3
    e = listener.handle(audio(1.5))
    assert e["reason"] == "after_name"
    assert sent == [(8000 + 3200 + 24000, None)]


def test_name_alone_expires():
    listener, clock, sent = make(["Igor", "éteins la cuisine"])
    listener.handle(audio())
    clock.t = 20
    assert not listener.handle(audio())["accepted"]
    assert sent == []


def test_followup_after_a_question_keeps_the_conversation():
    listener, clock, sent = make(["Igor baisse les volets", "oui le salon", "et la cuisine"])
    listener.handle(audio())          # Igor answers with a question
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
    listener, _, _ = make(["Igor éteins tout"], act=False)
    e = listener.handle(audio())
    assert e["accepted"] and "sent" not in e


def test_speech_going_on_after_a_pause_is_joined():
    listener, _, sent = make(["Igor donne-moi les nouvelles"])
    parts = [audio(4), audio(3)]
    e = listener.handle(audio(2), more=lambda: parts.pop(0) if parts else None)
    assert e["joined"] == 2
    assert sent[0][0] == 16000 * (2 + 4 + 3) + 2 * 3200


def test_long_speech_only_head_and_tail_transcribed():
    lengths = []

    def stt(a):
        lengths.append(len(a))
        return Transcript("bla" if len(lengths) == 1 else "merci Igor", 0.5, 0.1, -0.2)

    listener = Listener(stt, Addressing(), None)
    e = listener.handle(audio(40))
    assert lengths == [8 * 16000, 6 * 16000]
    assert e["accepted"] and e["reason"] == "name"


def test_doubtful_transcription_with_the_name_is_kept():
    def stt(a):
        return Transcript("tu montons i gor", 0.2, 0.3, -1.4)
    e = Listener(stt, Addressing(), None).handle(audio())
    assert e["accepted"] and e["reason"] == "name"


def test_doubtful_transcription_without_the_name_is_noise():
    def stt(a):
        return Transcript("va plutôt ta blètre", 0.2, 0.3, -1.4)
    assert Listener(stt, Addressing(), None).handle(audio())["reason"] == "noise"


def test_the_tablet_is_told_before_the_words_are_sent():
    events = []
    clock = Clock()
    heard = iter(["Igor ?", "allume la cuisine", "Éteins la lumière Igor", "il fait beau"])
    stt = lambda a: Transcript(next(heard), 0.3, 0.1, -0.2)  # noqa: E731

    def do(a, conversation):
        events.append("sent")
        return Outcome(speech="Fait.")

    listener = Listener(stt, Addressing(), do, clock=clock,
                        on_heard=lambda waiting, seconds: events.append(("heard", waiting, seconds)))
    listener.handle(audio())              # the name alone: waiting for the order
    listener.handle(audio())              # the order: heard, then sent
    listener.handle(audio())              # name in the sentence: heard, then sent
    listener.handle(audio())              # not for Igor: nothing
    assert events == [("heard", True, 6.0), ("heard", False, None), "sent", ("heard", False, None), "sent"]


def test_a_question_from_igor_shows_it_listens_for_the_answer():
    events = []
    clock = Clock()
    heard = iter(["Igor, ferme les volets", "oui"])
    stt = lambda a: Transcript(next(heard), 0.3, 0.1, -0.2)  # noqa: E731

    def do(a, conversation):
        events.append(("sent", conversation))
        first = len(events) == 2
        return Outcome(speech="Tous les volets ?" if first else "C'est fait.",
                       conversation_id="c1", continue_conversation=first)

    listener = Listener(stt, Addressing(), do, clock=clock, followup_seconds=8,
                        on_heard=lambda waiting, seconds: events.append(("heard", waiting, seconds)))
    listener.handle(audio())   # the order; Igor asks back
    clock.t = 3
    e = listener.handle(audio())   # the answer, without the name
    assert e["reason"] == "followup"
    assert events == [("heard", False, None), ("sent", None), ("heard", True, 8),
                      ("heard", False, None), ("sent", "c1")]


def make_timed(texts):
    clock = Clock()
    heard = iter(texts)
    sent = []

    def stt(a):
        return Transcript(next(heard), 0.3, 0.1, -0.2)

    def do(a, conversation):
        sent.append(len(a))
        return Outcome(speech="Fait.")

    return Listener(stt, Addressing(), do, clock=clock), sent


def test_name_at_the_end_after_a_pause_takes_the_sentence_before():
    listener, sent = make_timed(["Éteins la lumière du salon", "Igor"])
    assert listener.handle(audio(1.0), None, 0.0, 1.0)["reason"] == "not_addressed"
    e = listener.handle(audio(0.5), None, 2.0, 2.5)            # 1 s later
    assert e["sent"] and e["previous"] == "Éteins la lumière du salon"
    assert sent == [16000 + 3200 + 8000]                         # before + gap + "Igor"


def test_end_of_the_order_with_the_name_takes_its_start():
    listener, sent = make_timed(["Éteins la lumière", "du salon, Igor"])
    listener.handle(audio(1.0), None, 0.0, 1.0)
    e = listener.handle(audio(1.0), None, 1.8, 2.8)
    assert e["sent"] and e["previous"] == "Éteins la lumière"


def test_a_complete_order_with_the_name_stands_alone():
    listener, sent = make_timed(["Ferme les volets", "Igor, éteins la lumière"])
    listener.handle(audio(1.0), None, 0.0, 1.0)
    e = listener.handle(audio(1.0), None, 1.5, 2.5)
    assert e["sent"] and "previous" not in e and sent == [16000]


def test_chatter_before_the_name_is_not_joined():
    listener, sent = make_timed(["On a bien mangé hier", "Igor"])
    listener.handle(audio(1.0), None, 0.0, 1.0)
    e = listener.handle(audio(0.5), None, 1.5, 2.0)
    assert e["reason"] == "name_alone_waiting" and sent == []   # waits for the order


def test_too_long_a_pause_and_the_name_waits_for_the_order():
    listener, sent = make_timed(["Éteins la lumière", "Igor"])
    listener.handle(audio(1.0), None, 0.0, 1.0)
    e = listener.handle(audio(0.5), None, 5.0, 5.5)             # 4 s later
    assert e["reason"] == "name_alone_waiting" and sent == []
