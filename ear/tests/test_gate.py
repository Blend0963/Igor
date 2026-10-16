from mado_ear.gate import SatelliteGate


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
