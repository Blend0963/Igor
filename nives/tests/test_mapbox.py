"""Mapbox as the last routing backup (mapbox.py)."""

import importlib.util
import pathlib

_SPEC = importlib.util.spec_from_file_location("nives_mapbox", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/mapbox.py")
MB = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(MB)


def test_url_and_params():
    u = MB.directions_url([(48.97, 2.25), (48.9, 2.3)], "car")
    assert u.endswith("/driving-traffic/2.250000,48.970000;2.300000,48.900000")
    assert "/walking/" in MB.directions_url([(1, 2), (3, 4)], "pedestrian")
    p = MB.directions_params("pk.x", "car", ["tollRoads", "motorways", "nope"])
    assert p["exclude"] == "toll,motorway" and p["language"] == "fr" and p["access_token"] == "pk.x"
    assert "exclude" not in MB.directions_params("pk.x", "bicycle", ["tollRoads"])


def test_parse_route():
    body = {"routes": [{"distance": 1200, "duration": 300, "duration_typical": 240,
                        "geometry": {"coordinates": [[2.25, 48.97], [2.26, 48.975], [2.27, 48.98]]},
                        "legs": [{"steps": [
                            {"maneuver": {"type": "depart", "location": [2.25, 48.97], "instruction": "Partez vers l'est."}, "name": "Rue A"},
                            {"maneuver": {"type": "turn", "modifier": "slight left", "location": [2.26, 48.975], "instruction": "Serrez à gauche."}, "name": "D14", "ref": "D 14"},
                            {"maneuver": {"type": "roundabout", "modifier": "right", "exit": 2, "location": [2.265, 48.977], "instruction": "Au rond-point, 2e sortie."}},
                            {"maneuver": {"type": "arrive", "modifier": "left", "location": [2.27, 48.98], "instruction": "Vous êtes arrivé."}}]}]}]}
    r = MB.parse_route(body)
    assert r["source"] == "mapbox" and r["distance"] == 1200 and r["delay"] == 60 and len(r["coords"]) == 3
    assert [s["maneuver"] for s in r["steps"]] == ["DEPART", "BEAR_LEFT", "ROUNDABOUT_RIGHT", "ARRIVE_LEFT"]
    assert r["steps"][1]["refs"] == ["D 14"] and r["steps"][2]["exit"] == "2"
    assert MB.parse_route({"routes": []}) is None and MB.parse_route(None) is None
