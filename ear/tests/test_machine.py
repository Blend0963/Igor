import os

from igor_ear import machine


def make_card(root, busy="37", used=str(9 * 1024 ** 3), total=str(16 * 1024 ** 3)):
    device = root / "card1" / "device"
    hw = device / "hwmon" / "hwmon3"
    hw.mkdir(parents=True)
    (device / "gpu_busy_percent").write_text(busy + "\n")
    (device / "mem_info_vram_used").write_text(used + "\n")
    (device / "mem_info_vram_total").write_text(total + "\n")
    (hw / "temp1_input").write_text("61000\n")
    (hw / "temp1_label").write_text("edge\n")
    (hw / "temp2_input").write_text("74000\n")
    (hw / "temp2_label").write_text("junction\n")
    (root / "card0").mkdir()  # a card without load: skipped
    return device


def test_reads_an_amd_card(tmp_path):
    device = make_card(tmp_path)
    assert machine.find_card(str(tmp_path)) == str(device)
    g = machine.read_gpu(str(device))
    assert g.load == 37 and g.temperature == 61.0 and g.junction == 74.0
    out = machine.states(g, "igor_ear")
    assert out["sensor.igor_ear_gpu_load"]["state"] == 37
    assert out["sensor.igor_ear_gpu_temperature"]["attributes"]["junction"] == 74.0
    mem = out["sensor.igor_ear_gpu_memory"]
    assert mem["state"] == 56 and mem["attributes"]["used_gib"] == 9.0 and mem["attributes"]["total_gib"] == 16.0


def test_no_card_sends_nothing(tmp_path):
    assert machine.find_card(str(tmp_path)) is None
    p = machine.Publisher("http://ha", "t", device=None)
    p.device = None
    assert p.once() == 0


def test_posts_each_sensor(tmp_path, monkeypatch):
    device = make_card(tmp_path)
    sent = []
    monkeypatch.setattr(machine, "post", lambda url, token, entity, body: sent.append(entity))
    p = machine.Publisher("http://ha", "t", device=str(device))
    assert p.once() == 3
    assert sorted(sent) == ["sensor.igor_ear_gpu_load", "sensor.igor_ear_gpu_memory", "sensor.igor_ear_gpu_temperature"]
