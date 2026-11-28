"""Mapbox for Igor: its routes as the last backup (after TomTom and HERE),
read into the card's route shape (the same as TomTom's and HERE's: points
[lon, lat], length, time, delay, the instructions placed by their point).
The token is the one of Igor's options (a public pk.… token). Pure: tested
without network."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

DIRECTIONS_URL = "https://api.mapbox.com/directions/v5/mapbox/{profile}/{coords}"
PROFILES = {"car": "driving-traffic", "pedestrian": "walking", "bicycle": "cycling"}
EXCLUDE = {"tollRoads": "toll", "motorways": "motorway", "ferries": "ferry"}


def directions_url(points: list[tuple[float, float]], mode: str = "car") -> str:
    """points as (lat, lon), from the start to the end through the stops."""
    coords = ";".join(f"{p[1]:.6f},{p[0]:.6f}" for p in points)
    return DIRECTIONS_URL.format(profile=PROFILES.get(mode, "driving-traffic"), coords=quote(coords, safe=",;."))


def directions_params(token: str, mode: str = "car", avoid: list[str] | tuple = (), alternatives: bool = False) -> dict[str, str]:
    p = {"geometries": "geojson", "overview": "full", "steps": "true", "language": "fr", "access_token": token,
         "alternatives": "true" if alternatives else "false"}
    ex = [EXCLUDE[a] for a in avoid if a in EXCLUDE] if mode == "car" else []
    if ex:
        p["exclude"] = ",".join(dict.fromkeys(ex))
    return p


def _maneuver(m: dict) -> str:
    t, mod = str(m.get("type") or ""), str(m.get("modifier") or "")
    side = "LEFT" if "left" in mod else "RIGHT" if "right" in mod else ""
    if t == "depart":
        return "DEPART"
    if t == "arrive":
        return "ARRIVE" + ("_" + side if side else "")
    if t in ("roundabout", "rotary", "roundabout turn", "exit roundabout", "exit rotary"):
        return "ROUNDABOUT_" + (side or "RIGHT")
    if mod == "uturn":
        return "MAKE_UTURN"
    if t == "off ramp":
        return "MOTORWAY_EXIT_" + (side or "RIGHT")
    if t in ("on ramp", "merge"):
        return "ENTER_MOTORWAY"
    if t == "fork":
        return "KEEP_" + side if side else "STRAIGHT"
    if not side or mod == "straight":
        return "STRAIGHT"
    if mod.startswith("sharp"):
        return "SHARP_" + side
    if mod.startswith("slight"):
        return "BEAR_" + side
    return "TURN_" + side


def parse_route(body: Any) -> dict | None:
    """Mapbox's first route → the card's route."""
    routes = body.get("routes") if isinstance(body, dict) else None
    if not routes or not isinstance(routes[0], dict):
        return None
    r = routes[0]
    coords = [[round(float(p[0]), 6), round(float(p[1]), 6)] for p in ((r.get("geometry") or {}).get("coordinates") or []) if len(p) >= 2]
    if len(coords) < 2:
        return None
    steps = []
    for leg in r.get("legs") or []:
        for st in leg.get("steps") or []:
            m = st.get("maneuver") or {}
            loc = m.get("location") or coords[0]
            steps.append({"at": 0.0, "loc": [round(float(loc[0]), 6), round(float(loc[1]), 6)], "maneuver": _maneuver(m),
                          "text": str(m.get("instruction") or "")[:160], "road": str(st.get("name") or "")[:80],
                          "refs": [x for x in str(st.get("ref") or "").split(";") if x][:3],
                          "exit": str(m.get("exit") or ""), "to": str(st.get("destinations") or "")[:60]})
    duration = float(r.get("duration") or 0)
    typical = float(r.get("duration_typical") or duration)
    return {"coords": coords, "jams": [], "limits": [], "lanes": [], "tolls": [], "tunnels": [], "ferries": [], "motorways": [], "lez": [],
            "distance": float(r.get("distance") or 0), "duration": duration, "delay": max(0.0, duration - typical), "steps": steps,
            "toll_eur": None, "source": "mapbox"}
