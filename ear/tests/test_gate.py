from igor_ear.gate import SatelliteGate


class Clock:
    t = 100.0

    def __call__(self):
        return self.t


def test_busy_then_tail_then_free():
    c = Clock()
    g = SatelliteGate(c)
    g.update("idle")
    assert not g.busy()
    g.update("listening")
    assert g.busy()
    c.t += 3
    g.update("processing")
    assert g.busy()
    c.t += 2
    g.update("idle")
    assert g.busy()          # tail: the end of its own voice
    c.t += 2
    assert not g.busy()


def test_stuck_listening_is_ignored():
    c = Clock()
    g = SatelliteGate(c)
    g.update("listening")
    assert g.busy()
    c.t += 31
    assert not g.busy()
    c.t += 600
    assert not g.busy()


def test_a_long_answer_is_still_busy():
    c = Clock()
    g = SatelliteGate(c)
    g.update("responding")
    c.t += 60
    assert g.busy()
    c.t += 200
    assert not g.busy()


def test_unknown_state_is_free():
    assert not SatelliteGate(Clock()).busy()


class FakeSpeakers:
    """Sound comes out between `start` and `stop` on the shared clock."""

    def __init__(self, t, start=None, stop=None, listening=True):
        self.t, self.start, self.stop, self.listening = t, start, stop, listening

    @property
    def last_sound(self):
        if self.start is None or self.t[0] < self.start:
            return float("-inf")
        return min(self.t[0], self.stop)

    def quiet_for(self, seconds):
        return not self.listening or self.t[0] - self.last_sound >= seconds


def voice_with(speakers, t, **kw):
    from igor_ear.gate import OwnVoice

    def sleep(s):
        t[0] += s
    return OwnVoice(speakers, tail=0.3, settle=2.0, clock=lambda: t[0], sleep=sleep, **kw)


def test_own_voice_closes_the_ear_until_the_speakers_are_quiet():
    t = [0.0]
    sp = FakeSpeakers(t, start=0.5, stop=1.4)
    voice = voice_with(sp, t)
    seen = []

    def speak():
        seen.append(voice.speaking())
        t[0] += 1.0                # the announce call returns after 1 s

    voice.say(speak)
    assert seen == [True]
    assert 1.6 < t[0] < 1.9 and voice.speaking()   # quiet for 0.3 s, then the tail
    t[0] += 0.31
    assert not voice.speaking() and voice.just_spoke()
    t[0] += 5
    assert not voice.just_spoke()


def test_announce_returning_before_the_voice_plays_keeps_the_ear_closed():
    # Home Assistant answers at 0.2 s; the voice plays from 1.5 s to 3.5 s.
    t = [0.0]
    voice = voice_with(FakeSpeakers(t, start=1.5, stop=3.5), t)

    def speak():
        t[0] += 0.2
    voice.say(speak)
    assert t[0] >= 3.8 and voice.speaking()
    t[0] += 0.31
    assert not voice.speaking()


def test_a_voice_never_seen_waits_start_wait_only():
    t = [0.0]
    voice = voice_with(FakeSpeakers(t), t)
    voice.say(lambda: None)
    assert 4.0 <= t[0] < 4.2


def test_own_voice_waits_at_most_settle_when_a_television_plays():
    t = [0.0]
    voice = voice_with(FakeSpeakers(t, start=-100, stop=1000), t)
    voice.say(lambda: None)
    assert 2.0 <= t[0] < 2.2
    t[0] += 0.31
    assert not voice.speaking()


def test_unwatched_speakers_close_the_ear_for_the_call_only():
    t = [0.0]
    voice = voice_with(FakeSpeakers(t, listening=False), t)

    def speak():
        t[0] += 1.0
    voice.say(speak)
    assert t[0] == 1.0 and voice.speaking()
    t[0] += 0.31
    assert not voice.speaking()


def test_gate_tail_can_be_left_out():
    from igor_ear.gate import SatelliteGate

    t = [0.0]
    gate = SatelliteGate(clock=lambda: t[0])
    gate.update("responding")
    t[0] = 1
    gate.update("idle")
    t[0] = 1.5
    assert gate.busy() and not gate.busy(tail=False)


def test_just_spoke_covers_the_speakers_hold():
    t = [0.0]
    voice = voice_with(FakeSpeakers(t, start=0.1, stop=0.8), t)
    voice.say(lambda: None)
    t[0] = voice.ended + 0.01
    assert voice.just_spoke(3.5)
    t[0] = voice.ended + 3.6
    assert not voice.just_spoke(3.5)


def test_between_waits_for_the_first_sentence_to_be_heard():
    # Sentence one is announced at 0, returns at 0.2 and plays 1.0 to 2.0:
    # the second is announced only once it has been heard to its end.
    t = [0.0]
    voice = voice_with(FakeSpeakers(t, start=1.0, stop=2.0), t)
    times = []

    def speak():
        began = t[0]
        t[0] += 0.2
        voice.between(began)
        times.append(t[0])

    voice.say(speak)
    assert 2.3 <= times[0] < 2.5
