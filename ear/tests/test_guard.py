from igor_ear import guard as g
from igor_ear.screen import Screen, ScreenSettings


def test_the_alert_comes_first_and_an_unknown_key_locks():
    assert g.mode_of("on", "off", "binary_sensor.key", "binary_sensor.alarm") == ""
    assert g.mode_of("off", "off", "binary_sensor.key", "binary_sensor.alarm") == "lock"
    assert g.mode_of("unavailable", None, "binary_sensor.key", "") == "lock"
    assert g.mode_of(None, None, "binary_sensor.key", "") == "lock"
    assert g.mode_of("off", "on", "binary_sensor.key", "binary_sensor.alarm") == "alarm"
    assert g.mode_of(None, None, "", "") == ""


def test_states_from_home_assistant_reach_the_guard():
    guard = g.Guard("binary_sensor.key", "binary_sensor.alarm", "", "http://ha", "t", runner=lambda cmd: None)
    sc = Screen(ScreenSettings(bus=4), runner=lambda cmd, timeout=10: True, keyboard_reader=lambda m="": True, guard=guard)
    sc.handle({"type": "event", "event": {"a": {"binary_sensor.key": {"s": "on"}, "binary_sensor.alarm": {"s": "off"}}}})
    assert guard.mode == ""
    sc.handle({"type": "event", "event": {"c": {"binary_sensor.key": {"+": {"s": "off"}}}}})
    assert guard.mode == "lock"
    sc.handle({"type": "event", "event": {"c": {"binary_sensor.alarm": {"+": {"s": "on"}}}}})
    assert guard.mode == "alarm"
    sc.handle({"type": "event", "event": {"c": {"binary_sensor.alarm": {"+": {"s": "off"}}, "binary_sensor.key": {"+": {"s": "on"}}}}})
    assert guard.mode == ""


def test_the_page_never_sees_the_token(monkeypatch):
    seen = {}

    class Resp:
        def __init__(self, body): self.body = body
        def read(self, *a): return self.body
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake(req, timeout=10):
        seen["url"], seen["auth"] = req.full_url, req.headers.get("Authorization")
        return Resp(b'{"service_response": {"ok": false, "message": "Code erron\\u00e9."}}')

    monkeypatch.setattr(g.urllib.request, "urlopen", fake)
    guard = g.Guard("binary_sensor.key", "", "", "http://ha:8123/", "secret", runner=lambda cmd: None)
    r = guard.disarm("1234")
    assert r == {"ok": False, "message": "Code erroné."}
    assert seen["url"] == "http://ha:8123/api/services/nives/disarm?return_response" and seen["auth"] == "Bearer secret"
    assert "secret" not in g.PAGE.read_text()
