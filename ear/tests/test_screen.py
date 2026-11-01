import os

from igor_ear import screen
from igor_ear.config import _input_code
from igor_ear.screen import Screen, ScreenSettings

DEVICES = """I: Bus=0011 Vendor=0001 Product=0001 Version=ab41
N: Name="AT Translated Set 2 keyboard"
H: Handlers=sysrq kbd event0 leds

I: Bus=0003 Vendor=0627 Product=0001 Version=0001
N: Name="QEMU QEMU USB Tablet"
H: Handlers=mouse0 event1

I: Bus=0003 Vendor=046d Product=c31c Version=0110
N: Name="Logitech USB Keyboard"
H: Handlers=sysrq kbd leds event2
B: KEY=1000000000007 ff9f207ac14057ff febeffdfffefffff fffffffffffffffe

"""

SOUND_CARD = """I: Bus=0003 Vendor=1b3f Product=2008 Version=0100
N: Name="Generalplus Usb Audio Device"
H: Handlers=kbd event5
B: KEY=e000000000000 0

"""


def test_only_a_real_usb_keyboard_counts():
    devs = screen.parse_inputs(DEVICES)
    assert [d.name for d in devs][-1] == "Logitech USB Keyboard"
    assert screen.keyboard_here(devs)
    assert screen.keyboard_here(devs, "logitech")
    assert not screen.keyboard_here(devs, "cherry")
    assert not screen.keyboard_here(screen.parse_inputs(DEVICES.split("\n\nI: Bus=0003 Vendor=046d")[0]))


def test_a_sound_card_with_volume_keys_is_not_a_keyboard():
    alone = screen.parse_inputs(DEVICES.split("\n\nI: Bus=0003 Vendor=046d")[0] + "\n\n" + SOUND_CARD)
    assert alone[-1].name == "Generalplus Usb Audio Device"
    assert not screen.keyboard_here(alone)
    assert screen.keyboard_here(screen.parse_inputs(DEVICES + SOUND_CARD))


def test_ddc_bus_from_the_connector(tmp_path):
    drm = tmp_path / "drm"
    (drm / "card1-HDMI-A-1").mkdir(parents=True)
    (tmp_path / "i2c-7").mkdir()
    os.symlink(tmp_path / "i2c-7", drm / "card1-HDMI-A-1" / "ddc")
    (drm / "card0-Virtual-1").mkdir()
    assert screen.ddc_bus("HDMI-A-1", str(drm)) == 7
    assert screen.ddc_bus("DP-1", str(drm)) is None


def test_input_names():
    assert _input_code("hdmi") == 0x11 and _input_code("dp") == 0x0F and _input_code("0x12") == 0x12 and _input_code(15) == 15


def make(pc_entity=""):
    calls = []
    sc = Screen(ScreenSettings(bus=4, pc_entity=pc_entity), runner=lambda cmd, timeout=10: calls.append(cmd) or True,
                keyboard_reader=lambda match="": True)
    return sc, calls


def test_the_machine_losing_the_keyboard_sends_the_screen_away():
    sc, calls = make()
    sc.keyboard = True
    sc.keyboard_changed(False)
    assert calls[-1] == ["ddcutil", "--bus", "4", "--noverify", "setvcp", "60", "0x0f"]
    sc.on = False
    sc.keyboard_changed(True)
    assert ["swaymsg", "output", "HDMI-A-1", "power", "on"] in calls
    assert calls[-1][-1] == "0x11"


def test_a_keyboard_dropping_for_a_moment_does_not_move_the_screen():
    sc, calls = make()
    sc.keyboard, sc.last_seen = True, 0.0
    for t, present in ((0.5, False), (1.0, True), (1.5, False), (2.0, False)):
        sc.keyboard_seen(present, 1.0 + t if present else t + 1.0)
    assert not any("setvcp" in c for c in calls) and sc.keyboard
    sc.keyboard_seen(False, 10.0)
    assert not sc.keyboard and calls[-1][-1] == "0x0f"


def test_a_key_waking_the_screen_is_seen(monkeypatch):
    sc, calls = make()
    sc.on = False
    sent = []
    sc.publish = lambda: sent.append(sc.on)
    out = '[{"name": "HDMI-A-1", "power": true}, {"name": "Virtual-1", "power": false}]'
    monkeypatch.setattr(screen.subprocess, "run", lambda *a, **k: type("R", (), {"stdout": out})())
    sc.sync_power()
    assert sc.on and sent == [True]
    sc.sync_power()
    assert sent == [True]


def test_orders_from_home_assistant():
    sc, calls = make("binary_sensor.pc")
    sc.handle({"type": "event", "event": {"event_type": "igor_screen", "data": {"action": "off"}}})
    assert calls[-1][-1] == "off" and not sc.on
    # The PC is off: the screen stays on the dashboard.
    sc.handle({"type": "event", "event": {"a": {"binary_sensor.pc": {"s": "off", "a": {}}}}})
    n = len(calls)
    sc.handle({"type": "event", "event": {"event_type": "igor_screen", "data": {"action": "pc"}}})
    assert len(calls) == n
    sc.handle({"type": "event", "event": {"c": {"binary_sensor.pc": {"+": {"s": "on"}}}}})
    sc.handle({"type": "event", "event": {"event_type": "igor_screen", "data": {"action": "pc"}}})
    assert calls[-1][-1] == "0x0f"


def test_settings_windows_from_the_dashboard():
    sc, calls = make()
    sc.handle({"type": "event", "event": {"event_type": "igor_screen", "data": {"action": "app", "app": "equalizer"}}})
    assert calls[-1] == ["swaymsg", "exec", "easyeffects"]
    assert calls[-2][-2:] == ["fullscreen", "disable"]
    n = len(calls)
    sc.handle({"type": "event", "event": {"event_type": "igor_screen", "data": {"action": "app", "app": "rm -rf /"}}})
    assert len(calls) == n
    sc.handle({"type": "event", "event": {"event_type": "igor_screen", "data": {"action": "close"}}})
    assert calls[-2][0] == "swaymsg" and calls[-2][2] == "kill" and "easyeffects" in calls[-2][1]
    assert calls[-1] == ["swaymsg", '[app_id="^chromium"]', "fullscreen", "enable"]


def test_chromium_back_to_fullscreen_without_settings_windows(monkeypatch):
    sc, calls = make()
    tree = {"nodes": [{"nodes": [{"app_id": "chromium", "fullscreen_mode": 0, "nodes": []}], "floating_nodes": []}]}

    class R:
        stdout = __import__("json").dumps(tree)
    monkeypatch.setattr(screen.subprocess, "run", lambda *a, **k: R())
    sc.refullscreen()
    assert calls[-1] == ["swaymsg", '[app_id="^chromium"]', "fullscreen", "enable"]
    n = len(calls)
    tree["nodes"][0]["floating_nodes"] = [{"app_id": "pavucontrol", "nodes": []}]
    R.stdout = __import__("json").dumps(tree)
    sc.refullscreen()
    assert len(calls) == n
