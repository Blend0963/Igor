import threading

from igor_ear.speech import Sentences, Speaker


def test_sentences_wait_for_a_whole_sentence():
    s = Sentences(min_chars=25)
    assert s.push("Je vais très bien, merci") == []
    assert s.push(". Et vous, comment allez-") == ["Je vais très bien, merci."]
    assert s.push("vous ce soir ?") == []
    assert s.rest() == "Et vous, comment allez-vous ce soir ?"
    assert s.rest() == ""


def test_a_short_sentence_waits_for_the_next_and_numbers_do_not_cut():
    s = Sentences(min_chars=25)
    assert s.push("Bien. Il fait 21.5 degrés dans le salon. ") == ["Bien. Il fait 21.5 degrés dans le salon."]
    assert s.push("« Oui ! » Et après ") == []


class Voice:
    def __init__(self):
        self.calls, self.lock = [], threading.Lock()

    def clock(self):
        return 0.0

    def say(self, speak):
        self.calls.append("open")
        speak()
        self.calls.append("close")

    def between(self, began):
        self.calls.append("heard")


def test_speaker_says_in_order_inside_one_say():
    voice, said = Voice(), []
    speaker = Speaker(said.append, voice)
    assert not speaker.started
    speaker.add("Première phrase.")
    speaker.add("  ")
    speaker.add("Deuxième phrase.")
    speaker.finish()
    assert said == ["Première phrase.", "Deuxième phrase."]
    assert voice.calls == ["open", "heard", "heard", "close"]


def test_a_failed_sentence_is_noted_and_the_next_still_said():
    voice, said = Voice(), []

    def say_one(s):
        if s.startswith("Mauvaise"):
            raise RuntimeError("HTTP 500")
        said.append(s)

    speaker = Speaker(say_one, voice)
    speaker.add("Mauvaise phrase.")
    speaker.add("Bonne phrase.")
    speaker.finish()
    assert said == ["Bonne phrase."] and speaker.errors == ["HTTP 500"]


def test_finish_without_sentences_does_nothing():
    Speaker(lambda s: None, Voice()).finish()
