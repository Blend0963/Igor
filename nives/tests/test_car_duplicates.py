"""The car's entities doubled by a changed unique_id (car.duplicate_pairs)."""

import importlib.util
import pathlib

_SPEC = importlib.util.spec_from_file_location("nives_car", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/car.py")
car = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(car)

# As a real install showed them: the originals orphaned, the « _2 » ones receiving.
NAMES = ["charge_moteur", "regime_moteur", "vitesse", "tension_batterie", "trajet", "codes_defaut"]
ENTRIES = [(f"sensor.peugeot_407_{n}", "template") for n in NAMES] + [(f"sensor.peugeot_407_{n}_2", "template") for n in NAMES[1:]]
ENTRIES += [("binary_sensor.peugeot_407_voyant_moteur", "template"), ("binary_sensor.peugeot_407_voyant_moteur_2", "template"),
            ("automation.peugeot_407_nouveau_defaut_moteur_2", "automation"), ("sensor.voiture_vitesse", "template")]


def test_orphans_are_mended_from_their_twin():
    orphans = {f"sensor.peugeot_407_{n}" for n in NAMES} | {"binary_sensor.peugeot_407_voyant_moteur"}
    out = car.duplicate_pairs(ENTRIES, orphans)
    assert ("sensor.peugeot_407_regime_moteur", "sensor.peugeot_407_regime_moteur_2") in out["fix"]
    assert ("binary_sensor.peugeot_407_voyant_moteur", "binary_sensor.peugeot_407_voyant_moteur_2") in out["fix"]
    assert len(out["fix"]) == len(NAMES) - 1 + 1  # charge_moteur has no twin; automations are not touched
    assert out["keep"] == []


def test_a_live_original_is_left_alone():
    out = car.duplicate_pairs(ENTRIES, orphans=set())
    assert out["fix"] == []
    assert ("sensor.peugeot_407_vitesse", "sensor.peugeot_407_vitesse_2") in out["keep"]


def test_other_entities_and_platforms_are_not_matched():
    entries = [("sensor.salon_temp", "template"), ("sensor.salon_temp_2", "template"),
               ("sensor.peugeot_407_vitesse", "mqtt"), ("sensor.peugeot_407_vitesse_2", "template")]
    assert car.duplicate_pairs(entries, {"sensor.salon_temp", "sensor.peugeot_407_vitesse"}) == {"fix": [], "keep": []}
