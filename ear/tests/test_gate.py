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


def test_own_voice_closes_the_ear_until_the_speakers_are_quiet():
    from igor_ear.gate import OwnVoice

    t = [0.0]
    clock = lambda: t[0]  # noqa: E731
    sound_until = [0.0]
    seen = []

    def sleep(s):
        t[0] += s

    voice = OwnVoice(quiet=lambda s: t[0] - sound_until[0] >= s, tail=0.3, settle=2.0, clock=clock, sleep=sleep)

    def speak():
        seen.append(voice.speaking())
        t[0] += 1.0                # the announce call returns after 1 s
        sound_until[0] = t[0] + 0.4  # the last of the voice still playing

    voice.say(speak)
    assert seen == [True]
    assert 1.6 < t[0] < 1.9 and voice.speaking()   # quiet for 0.3 s, then the tail
    t[0] += 0.31
    assert not voice.speaking() and voice.just_spoke()
    t[0] += 5
    assert not voice.just_spoke()


def test_own_voice_waits_at_most_settle_when_a_television_plays():
    from igor_ear.gate import OwnVoice

    t = [0.0]

    def sleep(s):
        t[0] += s

    voice = OwnVoice(quiet=lambda s: False, tail=0.3, settle=2.0, clock=lambda: t[0], sleep=sleep)
    voice.say(lambda: None)
    assert 2.0 <= t[0] < 2.2
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
