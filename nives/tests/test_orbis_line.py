"""The route's line from TomTom Orbis, the rest from the classic route (traffic.py)."""

import importlib.util
import math
import pathlib

_SPEC = importlib.util.spec_from_file_location(
    "nives_traffic", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/traffic.py"
)
traffic = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(traffic)

M = 1 / 111195.0  # one metre of latitude


def line(n, east_m=0.0, step_m=10.0):
    """A road going north from (2.0, 48.0), every step_m, east_m to the east."""
    k = 1 / math.cos(math.radians(48.0))
    return [[2.0 + east_m * M * k, 48.0 + i * step_m * M] for i in range(n)]


def classic():
    return {
        "coords": line(101),
        "jams": [{"start": 20, "end": 40, "level": 2, "delay": 60, "kind": "jam"}],
        "limits": [{"start": 0, "end": 100, "v": 50}],
        "lanes": [],
        "tolls": [[50, 60]],
        "tunnels": [], "ferries": [], "motorways": [], "lez": [],
        "steps": [{"at": 500, "loc": line(101)[50], "text": "Tournez à droite"}],
        "distance": 1000, "duration": 100, "delay": 60,
    }


def test_orbis_line_carries_the_stretches_by_place():
    # Orbis: the same way, 8 m to the east (the right-hand carriageway), twice as many points.
    o = line(201, east_m=8.0, step_m=5.0)
    out = traffic.onto_orbis(classic(), o)
    assert out is not None and out["geometry"] == "orbis"
    assert out["coords"] is o
    assert out["jams"][0]["start"] == 40 and out["jams"][0]["end"] == 80
    assert out["tolls"] == [[100, 120]]
    assert out["limits"][0]["end"] == 200
    # The rest is the classic route's.
    assert out["steps"][0]["text"] == "Tournez à droite" and out["delay"] == 60


def test_another_way_is_refused():
    assert traffic.onto_orbis(classic(), line(101, east_m=300.0)) is None
    # Much longer (another way round): refused before any matching.
    assert traffic.onto_orbis(classic(), line(301)) is None


def test_supporting_points_and_address():
    body = traffic.orbis_body(line(1001), every_m=80)
    pts = body["supportingPoints"]
    assert 100 <= len(pts) <= 140 and pts[0]["latitude"] == 48.0
    u = traffic.orbis_url((48.0, 2.0), (48.1, 2.1), [(48.05, 2.05)])
    assert u.startswith("https://api.tomtom.com/maps/orbis/routing/calculateRoute/48.000000,2.000000:48.050000,2.050000:")
    p = dict(traffic.orbis_params("K", ["tollRoads", "nope"]))
    assert p["apiVersion"] == "2" and p["avoid"] == "tollRoads"


def test_orbis_answer_points():
    body = {"routes": [{"legs": [{"points": [{"latitude": 48, "longitude": 2}, {"latitude": 48, "longitude": 2}, {"latitude": 48.1, "longitude": 2}]}]}]}
    assert traffic.orbis_coords(body) == [[2.0, 48.0], [2.0, 48.1]]
    assert traffic.orbis_coords({}) == []
