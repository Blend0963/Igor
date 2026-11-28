"""Walking, cycling and public transport: the queries and HERE Public Transit's answer."""

import importlib.util
import pathlib

_ROOT = pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives"


def _load(name, file):
    spec = importlib.util.spec_from_file_location(name, _ROOT / file)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


here = _load("nives_here_modes", "here.py")
traffic = _load("nives_traffic_modes", "traffic.py")


def test_tomtom_walk_and_bike_have_no_car_extras():
    d = traffic.route_params("K", 90, ["tollRoads"], 1, "fastest", "pedestrian")
    keys = [k for k, _ in d]
    assert dict(d)["travelMode"] == "pedestrian" and dict(d)["traffic"] == "false"
    assert "avoid" not in keys and "sectionType" not in keys and "vehicleHeading" not in keys
    assert dict(d)["maxAlternatives"] == "1"
    assert dict(traffic.route_params("K", None, mode="bicycle"))["travelMode"] == "bicycle"
    car = traffic.route_params("K", 90, ["tollRoads"])
    assert dict(car)["travelMode"] == "car" and ("avoid", "tollRoads") in car


def test_here_walk_has_no_tolls():
    d = dict(here.route_params("K", (48.9, 2.2), (48.8, 2.3), avoid=["tollRoads"], full=True, mode="pedestrian"))
    assert d["transportMode"] == "pedestrian" and "tolls" not in d["return"] and "avoid[features]" not in d


def test_transit_parse_legs_and_steps():
    walk = here.encode_polyline([[2.30, 48.80], [2.301, 48.801]])
    bus = here.encode_polyline([[2.301, 48.801], [2.31, 48.81], [2.32, 48.82]])
    body = {"routes": [{"sections": [
        {"type": "pedestrian", "polyline": walk, "travelSummary": {"duration": 120, "length": 150},
         "departure": {"time": "2026-11-28T14:00:00+01:00", "place": {"name": "Départ"}},
         "arrival": {"time": "2026-11-28T14:02:00+01:00", "place": {"name": "Mairie"}},
         "transport": {"mode": "pedestrian"},
         "actions": [{"action": "depart", "offset": 0, "instruction": "Partez vers le nord."}]},
        {"type": "transit", "polyline": bus, "travelSummary": {"duration": 600, "length": 3000},
         "departure": {"time": "2026-11-28T14:05:00+01:00", "place": {"name": "Mairie"}},
         "arrival": {"time": "2026-11-28T14:15:00+01:00", "place": {"name": "Gare"}},
         "transport": {"mode": "bus", "name": "73", "headsign": "La Défense", "color": "#e3051b"},
         "intermediateStops": [{}, {}, {}]},
    ]}]}
    routes = here.parse_transit(body)
    assert len(routes) == 1
    r = routes[0]
    assert r["mode"] == "transit" and r["distance"] == 3150 and r["duration"] == 720
    assert r["coords"][0] == [2.30, 48.80] and r["coords"][-1] == [2.32, 48.82]
    assert [leg["kind"] for leg in r["legs"]] == ["à pied", "bus"]
    assert r["legs"][1]["dep"] == "14:05" and r["legs"][1]["name"] == "73"
    assert r["steps"][0]["text"] == "Partez vers le nord."
    assert r["steps"][1]["text"] == "Prenez le bus 73 direction La Défense à Mairie (14:05), descendez à Gare après 4 arrêts"
    assert here.parse_transit({"routes": []}) == [] and here.parse_transit(None) == []
