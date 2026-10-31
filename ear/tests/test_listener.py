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


def test_a_faint_voice_is_brought_up_before_transcription():
    from igor_ear.stt import louder
    quiet = np.full(1000, 0.05, dtype=np.float32)
    assert abs(float(np.max(louder(quiet))) - 0.4) < 1e-6      # gain capped at 8
    assert abs(float(np.max(louder(np.full(10, 0.2, dtype=np.float32)))) - 0.6) < 1e-6
    loud = np.full(10, 0.9, dtype=np.float32)
    assert louder(loud) is loud                                  # never turned down
    assert louder(np.zeros(10, dtype=np.float32)).max() == 0


def test_a_name_one_letter_off_is_sent_and_noted():
    listener, _, sent = make(["Egor, éteins la lumière du salon"])
    e = listener.handle(audio())
    assert e["sent"] and e["reason"] == "name" and e["near_name"] is True


def test_the_name_alone_gets_a_spoken_answer_once():
    answered = []
    heard = iter(["Igor ?", "allume la cuisine", "Igor, éteins la lumière"])
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(),
                        lambda a, c: Outcome(speech="Fait."), clock=Clock(),
                        on_name_alone=lambda ready: answered.append(ready))
    listener.handle(audio())     # "Igor ?" -> "Oui ?"
    listener.handle(audio())     # the order
    listener.handle(audio())     # name with an order: no "Oui ?"
    assert len(answered) == 1


def test_the_wait_for_the_order_starts_once_igor_is_silent():
    events, ready = [], []
    clock = Clock()
    heard = iter(["Igor ?", "allume la cuisine"])
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(),
                        lambda a, c: events.append("sent") or Outcome(speech="Fait."), clock=clock, name_wait=8,
                        on_heard=lambda waiting, seconds: events.append(("heard", waiting, seconds)),
                        on_name_alone=ready.append)
    listener.handle(audio())
    assert events == [("heard", False, None)]  # heard; not yet "Je vous écoute"
    clock.t = 7                                  # a long "Oui, monsieur ?"
    ready[0]()
    assert events[-1] == ("heard", True, 8)
    clock.t = 13                                 # 6 s after it ended: still waited for
    e = listener.handle(audio())
    assert e["reason"] == "after_name" and events[-1] == "sent"


def test_settings_name_reply(tmp_path):
    from igor_ear.config import NAME_REPLIES, load
    f = tmp_path / "c.toml"
    f.write_text("")
    assert load(f).name_reply == list(NAME_REPLIES) and load(f).name_wait == 8.0
    f.write_text('[mode]\nname_reply = []\n')
    assert load(f).name_reply == []


def test_deck_deals_all_before_repeating():
    import random

    from igor_ear.config import NAME_REPLIES
    from igor_ear.replies import Deck

    deck = Deck(list(NAME_REPLIES), random.Random(1))
    said = [deck.draw() for _ in range(len(NAME_REPLIES) * 5)]
    for i in range(0, len(said), len(NAME_REPLIES)):
        assert sorted(said[i:i + len(NAME_REPLIES)]) == sorted(NAME_REPLIES)
    assert all(a != b for a, b in zip(said, said[1:]))
    assert all(r.endswith("?") for r in NAME_REPLIES) and len(NAME_REPLIES) >= 50
    assert not Deck([]) and Deck(["Oui ?"]).draw() == "Oui ?"


def test_the_name_alone_is_kept_though_whisper_doubts_it_is_speech():
    heard = iter([Transcript("Igor ?", 0.3, 0.8, -0.9), Transcript("bonjour", 0.3, 0.8, -0.2),
                  Transcript("Igor ?", 0.3, 0.95, -0.9)])
    listener = Listener(lambda a: next(heard), Addressing(), None)
    assert listener.handle(audio())["reason"] == "name_alone_waiting"
    listener._armed = None                   # no longer waiting for the order
    e = listener.handle(audio())
    assert e["reason"] == "noise" and e["no_speech"] == 0.8 and e["text"] == "bonjour"
    assert listener.handle(audio())["reason"] == "noise"


def test_while_waiting_for_the_order_everything_said_is_for_igor():
    clock = Clock()
    heard = iter([Transcript("Mado ?", 0.3, 0.1, -0.2), Transcript("le salon", 0.3, 0.85, -1.3)])
    sent = []
    busy = [False]
    listener = Listener(lambda a: next(heard), Addressing(names=["mado"]),
                        lambda a, c: sent.append(1) or Outcome(speech="Fait."), clock=clock,
                        busy=lambda: busy[0], on_name_alone=lambda ready: ready())
    assert listener.handle(audio())["reason"] == "name_alone_waiting"
    busy[0] = True                       # the satellite still says "responding"
    e = listener.handle(audio())         # doubtful for Whisper, but Igor is waiting
    assert e["reason"] == "after_name" and sent and e["satellite_busy_ignored"]


def test_a_hallucination_while_waiting_is_still_noise():
    heard = iter([Transcript("Igor ?", 0.3, 0.1, -0.2), Transcript("Sous-titrage ST' 501", 0.3, 0.5, -0.5)])
    listener = Listener(lambda a: next(heard), Addressing(), lambda a, c: Outcome(speech="Fait."),
                        clock=Clock(), on_name_alone=lambda ready: ready())
    listener.handle(audio())
    assert listener.handle(audio())["reason"] == "noise"


def test_igor_hearing_its_own_reply_ignores_it():
    clock = Clock()
    heard = iter(["Mado ?", "De quoi s'agit-il ?", "allume la cuisine"])
    sent = []
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(names=["mado"]),
                        lambda a, c: sent.append(1) or Outcome(speech="Fait."), clock=clock, name_wait=8,
                        on_name_alone=lambda ready: (listener.said("De quoi s'agit-il ?"), ready()))
    assert listener.handle(audio())["reason"] == "name_alone_waiting"
    e = listener.handle(audio())          # its own voice, come back
    assert e["reason"] == "own_voice" and not sent
    e = listener.handle(audio())          # still waiting for the order
    assert e["reason"] == "after_name" and sent


def test_its_voice_then_the_order_keeps_the_order():
    clock = Clock()
    heard = iter(["Que puis-je pour vous ? Éteins la lumière, Mado"])
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(names=["mado"]),
                        lambda a, c: Outcome(speech="Fait."), clock=clock)
    listener.said("Que puis-je pour vous ?")
    e = listener.handle(audio())
    assert e["sent"] and e["igor_said"] and e["reason"] == "name"


def test_an_answer_repeating_its_words_is_not_its_voice():
    clock = Clock()
    heard = iter(["Oui, tous les volets", "Tous les volets ?"])
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(),
                        lambda a, c: Outcome(speech="Fait."), clock=clock)
    listener.said("Tous les volets ?")
    assert listener.handle(audio())["reason"] != "own_voice"
    assert listener.handle(audio())["reason"] == "own_voice"


def test_its_voice_is_forgotten_after_a_while():
    clock = Clock()
    listener = Listener(lambda a: Transcript("Tous les volets ?", 0.3, 0.1, -0.2), Addressing(),
                        lambda a, c: Outcome(speech="Fait."), clock=clock)
    listener.said("Tous les volets ?")
    clock.t = 31
    assert listener.handle(audio())["reason"] != "own_voice"


def test_disarm_hands_the_order_to_the_satellite():
    heard = iter(["Mado ?", "allume la cuisine"])
    sent = []
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(names=["mado"]),
                        lambda a, c: sent.append(1) or Outcome(speech="Fait."), clock=Clock(),
                        busy=lambda: True, on_name_alone=lambda ready: listener.disarm())
    listener.busy = lambda: False
    listener.handle(audio())
    listener.busy = lambda: True          # the satellite listens
    assert listener.handle(audio())["reason"] == "satellite_busy" and not sent


def test_settings_name_alone(tmp_path):
    from igor_ear.config import load

    f = tmp_path / "c.toml"
    f.write_text('[mode]\nname_alone = "satellite"\n')
    assert load(f).name_alone == "satellite"
    f.write_text("")
    assert load(f).name_alone == "ear"


def test_a_long_order_begun_in_time_is_taken():
    clock = Clock()
    heard = iter(["Mado ?", "allume la lumière du salon et ferme les volets de la chambre"])
    sent = []
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(names=["mado"]),
                        lambda a, c: sent.append(1) or Outcome(speech="Fait."), clock=clock, name_wait=8,
                        on_name_alone=lambda ready: ready())
    listener.handle(audio())
    clock.t = 12                       # a 6 s order, begun at 6 s, handled at 12 s
    e = listener.handle(audio(6.0))
    assert e["reason"] == "after_name" and sent


def test_an_order_begun_too_late_is_not_taken():
    clock = Clock()
    heard = iter(["Mado ?", "allume la lumière"])
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(names=["mado"]),
                        lambda a, c: Outcome(speech="Fait."), clock=clock, name_wait=8,
                        on_name_alone=lambda ready: ready())
    listener.handle(audio())
    clock.t = 12                       # begun at 10 s
    assert listener.handle(audio(2.0))["reason"] == "not_addressed"


def test_a_padded_name_is_sent_and_the_order_is_taken_next():
    # 03:43 on the hub: "Igor" alone heard as "Je m'appelle Igor", then the order.
    clock = Clock()
    heard = iter(["Je m'appelle Igor.", "active la scène tamisée"])
    sent = []
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(),
                        lambda a, c: sent.append(c) or Outcome(speech="Je suis là, monsieur.", conversation_id="c9"),
                        clock=clock, followup_seconds=8)
    e = listener.handle(audio())
    assert e["sent"] and e["reason"] == "name" and e["short_call"]
    clock.t = 5
    e = listener.handle(audio())
    assert e["reason"] == "followup" and e["sent"] and sent == [None, "c9"]


def test_a_full_sentence_with_the_name_opens_no_window():
    clock = Clock()
    heard = iter(["Igor, éteins la lumière", "il fait beau"])
    listener = Listener(lambda a: Transcript(next(heard), 0.3, 0.1, -0.2), Addressing(),
                        lambda a, c: Outcome(speech="C'est éteint."), clock=clock)
    listener.handle(audio())
    clock.t = 4
    assert listener.handle(audio())["reason"] == "not_addressed"


# --- a television sounding: stricter -------------------------------------------
def make_strict(texts, sounding=True):
    from igor_ear.addressing import Addressing
    from igor_ear.listener import Listener, Outcome

    heard = iter(texts)
    sent = []

    def stt(a):
        return Transcript(next(heard), 0.3, 0.1, -0.2)

    def do(a, conversation):
        sent.append(a)
        return Outcome("x", "Très bien.", "conv", True)

    listener = Listener(stt, Addressing(), do, strict=lambda: sounding)
    return listener, sent


def test_with_a_television_the_followup_takes_an_order_or_a_short_answer_only():
    listener, sent = make_strict(["Igor, quelle heure est-il ?", "Il y a un humain pour tenter d'être un monstre.",
                                  "oui", "éteins la lumière du salon"])
    assert listener.handle(audio())["sent"]
    e = listener.handle(audio())
    assert not e["accepted"] and e["reason"] == "media_not_request" and e["media"]
    assert listener.handle(audio())["reason"] == "followup"
    assert listener.handle(audio())["accepted"]


def test_without_a_television_the_followup_takes_anything():
    listener, sent = make_strict(["Igor, quelle heure est-il ?", "Il y a un humain pour tenter d'être un monstre."],
                                 sounding=False)
    listener.handle(audio())
    e = listener.handle(audio())
    assert e["accepted"] and e["reason"] == "followup"


def test_with_a_television_a_name_one_letter_off_is_not_taken():
    listener, sent = make_strict(["Egor, éteins la lumière du salon"])
    e = listener.handle(audio())
    assert not e["accepted"] and e["reason"] == "near_name_media" and not sent
