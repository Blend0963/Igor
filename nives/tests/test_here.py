"""HERE: the queries and the reading of its answers (here.py)."""

import importlib.util
import pathlib

_SPEC = importlib.util.spec_from_file_location("nives_here", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/here.py")
here = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(here)


def test_flexible_polyline_reference_and_round_trip():
    # HERE's own example (flexible-polyline README): precision 5, no third dimension.
    pts = here.decode_polyline("BFoz5xJ67i1B1B7PzIhaxL7Y")
    assert pts == [[8.69821, 50.10228], [8.69567, 50.10201], [8.6915, 50.10063], [8.68752, 50.09878]]
    line = [[2.25, 48.95], [2.2512, 48.9507], [2.24, 48.94]]
    assert here.decode_polyline(here.encode_polyline(line)) == line


def test_route_params_avoid_and_via():
    p = here.route_params("K", (48.9, 2.2), (47.1, 1.5), [(48.0, 2.0)], ["tollRoads", "motorways", "nope"])
    d = dict(p)
    assert d["origin"] == "48.900000,2.200000" and d["currency"] == "EUR" and d["apikey"] == "K"
    assert d["via"] == "48.000000,2.000000!passThrough=true"
    assert d["avoid[features]"] == "tollRoad,controlledAccessHighway"
    assert "polyline" not in d["return"]
    assert "polyline" in dict(here.route_params("K", (1, 1), (2, 2), full=True))["return"]


def test_tolls_summed_at_cheapest_fare():
    body = {"routes": [{"sections": [
        {"tolls": [{"tollSystem": "APRR", "fares": [{"price": {"type": "value", "currency": "EUR", "value": 12.4}},
                                                    {"price": {"type": "value", "currency": "EUR", "value": 11.9}}]}]},
        {"tolls": [{"tollSystem": "COFIROUTE", "fares": [{"price": {"type": "range", "currency": "EUR", "minValue": 3.1, "maxValue": 3.5}}]}]},
        {"summary": {}},
    ]}]}
    t = here.toll_cost(body)
    assert t["eur"] == 15.0 and t["count"] == 2 and t["systems"] == ["APRR", "COFIROUTE"]
    assert here.toll_cost({"routes": [{"sections": [{}]}]})["eur"] == 0
    assert here.toll_cost({}) is None


def test_backup_route_read():
    line = [[2.25, 48.95], [2.26, 48.96], [2.27, 48.97]]
    body = {"routes": [{"sections": [{
        "polyline": here.encode_polyline(line),
        "summary": {"length": 2600, "duration": 300, "baseDuration": 240},
        "actions": [{"action": "depart", "offset": 0, "instruction": "Partez"},
                    {"action": "turn", "direction": "right", "offset": 1, "instruction": "Tournez à droite"},
                    {"action": "arrive", "offset": 2, "instruction": "Arrivée"}],
        "tolls": [{"fares": [{"price": {"type": "value", "value": 2.5, "currency": "EUR"}}]}],
    }]}]}
    r = here.parse_route(body)
    assert r["coords"] == line and r["distance"] == 2600 and r["delay"] == 60 and r["toll_eur"] == 2.5
    assert [s["maneuver"] for s in r["steps"]] == ["DEPART", "TURN_RIGHT", "ARRIVE"]
    assert r["steps"][1]["loc"] == [2.26, 48.96]


def test_shape_points_spread_inside():
    line = [[2.0 + i * 0.01, 48.0] for i in range(400)]  # ~290 km
    pts = here.shape_points(line, most=10)
    assert len(pts) == 10 and all(2.02 < p[1] < 5.97 for p in pts)
    assert here.shape_points(line[:5]) == []


def test_incidents_places_weather():
    inc = here.parse_incidents({"results": [
        {"location": {"shape": {"links": [{"points": [{"lat": 48.9, "lng": 2.2}, {"lat": 48.91, "lng": 2.21}]}]}},
         "incidentDetails": {"id": "x", "type": "construction", "roadClosed": True, "criticality": "major", "description": {"value": "Fermeture"}}},
        {"location": {"shape": {"links": [{"points": [{"lat": 48.8, "lng": 2.1}]}]}}, "incidentDetails": {"type": "accident"}},
    ]})
    assert inc[0]["closed"] and inc[0]["text"] == "Fermeture" and inc[1]["kind"] == "accident"
    pl = here.parse_places({"items": [{"title": "Parking Indigo", "position": {"lat": 47.1, "lng": 1.5}, "address": {"label": "Rue X"}, "distance": 120}]})
    assert pl == [{"name": "Parking Indigo", "lat": 47.1, "lon": 1.5, "address": "Rue X", "distance_m": 120, "hours": ""}]
    w = here.parse_weather({"places": [{"observations": [{"temperature": "12.0", "description": "Nuageux"}],
                                        "hourlyForecasts": [{"forecasts": [{"time": "t", "temperature": 11, "precipitationProbability": 40}]}]}]})
    assert w["now"]["temp"] == 12.0 and w["hours"][0]["rain_pct"] == 40
    assert here.parse_weather({}) is None
