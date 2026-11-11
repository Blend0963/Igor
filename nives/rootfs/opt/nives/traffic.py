"""Live traffic for the wall's GPS card: incidents and the flow map, from TomTom.

Everything here waits for a key: until one is entered in Igor's options
(« Clé TomTom »), the service answers ``{"enabled": false}`` and the tile view
answers 404, and the card shows no traffic. The key stays on this side: the
card asks Home Assistant (logged in, administrators only), which asks TomTom.

- Incidents: TomTom Traffic Incident Details v5, around a point (a box of
  ``radius_km``), in French: closed roads, roadworks, accidents, jams, with
  their line on the map and the delay they cause.
- Flow: TomTom's raster flow tiles (relative speed, the green / orange / red
  lines over the roads), relayed one tile at a time.
"""

from __future__ import annotations

import math
from typing import Any

INCIDENTS_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
FLOW_TILE_URL = "https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png"
FIELDS = (
    "{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,"
    "events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}"
)
MAX_INCIDENTS = 150

# TomTom's iconCategory → (kind, French label). « closed » is what the card
# warns about loudest: the road ahead cannot be driven.
CATEGORIES: dict[int, tuple[str, str]] = {
    0: ("other", "Incident"),
    1: ("accident", "Accident"),
    2: ("weather", "Brouillard"),
    3: ("danger", "Danger"),
    4: ("weather", "Pluie"),
    5: ("weather", "Verglas"),
    6: ("jam", "Bouchon"),
    7: ("lane", "Voie fermée"),
    8: ("closed", "Route fermée"),
    9: ("works", "Travaux"),
    10: ("weather", "Vent"),
    11: ("weather", "Inondation"),
    14: ("breakdown", "Véhicule en panne"),
}


def bbox(lat: float, lon: float, radius_km: float) -> tuple[float, float, float, float]:
    """minLon, minLat, maxLon, maxLat around a point (TomTom's order)."""
    dlat = radius_km / 111.32
    dlon = radius_km / (111.32 * max(0.05, math.cos(math.radians(lat))))
    return (round(lon - dlon, 5), round(lat - dlat, 5), round(lon + dlon, 5), round(lat + dlat, 5))


def incidents_params(key: str, lat: float, lon: float, radius_km: float) -> dict[str, str]:
    return {
        "key": key,
        "bbox": ",".join(str(v) for v in bbox(lat, lon, radius_km)),
        "fields": FIELDS,
        "language": "fr-FR",
        "timeValidityFilter": "present",
    }


def _line(geometry: Any) -> list[list[float]]:
    """The incident's points as [lon, lat] (a point becomes a one-point line)."""
    if not isinstance(geometry, dict):
        return []
    coords = geometry.get("coordinates")
    kind = geometry.get("type")
    try:
        if kind == "Point":
            return [[float(coords[0]), float(coords[1])]]
        if kind == "LineString":
            return [[float(c[0]), float(c[1])] for c in coords]
    except (TypeError, ValueError, IndexError):
        return []
    return []


def parse_incidents(body: Any) -> list[dict[str, Any]]:
    """TomTom's answer → the card's incidents, the worst first."""
    out: list[dict[str, Any]] = []
    items = body.get("incidents") if isinstance(body, dict) else None
    for item in items or []:
        if not isinstance(item, dict):
            continue
        props = item.get("properties") or {}
        line = _line(item.get("geometry"))
        if not line:
            continue
        try:
            category = int(props.get("iconCategory", 0))
        except (TypeError, ValueError):
            category = 0
        kind, label = CATEGORIES.get(category, CATEGORIES[0])
        events = [e.get("description") for e in props.get("events") or [] if isinstance(e, dict) and e.get("description")]
        text = str(events[0]) if events else label
        roads = [str(r) for r in props.get("roadNumbers") or [] if r]
        try:
            delay = max(0, int(props.get("delay") or 0))
        except (TypeError, ValueError):
            delay = 0
        try:
            magnitude = int(props.get("magnitudeOfDelay") or 0)
        except (TypeError, ValueError):
            magnitude = 0
        out.append(
            {
                "id": str(props.get("id") or len(out)),
                "kind": kind,
                "label": label,
                "closed": kind == "closed",
                "text": text[:120],
                "from": str(props.get("from") or "")[:80],
                "to": str(props.get("to") or "")[:80],
                "roads": roads[:4],
                "delay": delay,
                "magnitude": magnitude,
                "line": line,
            }
        )
    order = {"closed": 0, "accident": 1, "danger": 2, "lane": 3, "works": 4, "jam": 5}
    out.sort(key=lambda i: (order.get(i["kind"], 6), -i["magnitude"], -i["delay"]))
    return out[:MAX_INCIDENTS]


def tile_ok(z: int, x: int, y: int) -> bool:
    """A real tile of the flow map (TomTom serves zoom 0 to 22)."""
    return 0 <= z <= 22 and 0 <= x < 2 ** z and 0 <= y < 2 ** z


def flow_tile_url(z: int, x: int, y: int) -> str:
    return FLOW_TILE_URL.format(z=z, x=x, y=y)


# ----- a route that knows the traffic: TomTom Routing (same key) -----
ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute/{a}:{b}/json"
MAX_AVOID = 10


# What a route can be asked to keep off (the card's « éviter » choices).
AVOIDABLE = {"motorways", "tollRoads", "ferries", "unpavedRoads"}
# The stretches TomTom marks along a route: the traffic, the limits, the lanes
# to take, and what lies on the way (tolls, tunnels, ferries, motorways).
SECTION_TYPES = ("traffic", "speedLimit", "lanes", "tollRoad", "tunnel", "ferry", "motorway")


def route_params(
    key: str, heading: float | None, avoid: list[str] | tuple = (), alternatives: int = 0
) -> list[tuple[str, str]]:
    """The query as pairs (sectionType and avoid repeat)."""
    params = [
        ("key", key),
        ("traffic", "true"),
        ("travelMode", "car"),
        ("routeType", "fastest"),
        ("instructionsType", "text"),
        ("language", "fr-FR"),
        ("routeRepresentation", "polyline"),
    ]
    params += [("sectionType", t) for t in SECTION_TYPES]
    params += [("avoid", a) for a in avoid if a in AVOIDABLE]
    if alternatives > 0:
        params.append(("maxAlternatives", str(min(2, int(alternatives)))))
    if heading is not None:
        params.append(("vehicleHeading", str(int(heading) % 360)))
    return params


def route_url(origin: tuple[float, float], dest: tuple[float, float], via: list | tuple = ()) -> str:
    """origin, stops and dest as (lat, lon): TomTom's « a:stop:b »."""
    a = ":".join(f"{p[0]:.6f},{p[1]:.6f}" for p in [origin, *via])
    return ROUTE_URL.format(a=a, b=f"{dest[0]:.6f},{dest[1]:.6f}")


def avoid_body(boxes: list[list[float]]) -> dict[str, Any]:
    """[[minLon, minLat, maxLon, maxLat], …] → TomTom's avoidAreas."""
    rects = []
    for b in boxes[:MAX_AVOID]:
        rects.append(
            {
                "southWestCorner": {"latitude": b[1], "longitude": b[0]},
                "northEastCorner": {"latitude": b[3], "longitude": b[2]},
            }
        )
    return {"avoidAreas": {"rectangles": rects}} if rects else {}


def parse_route(body: Any) -> dict[str, Any] | None:
    """TomTom's first route (see parse_routes)."""
    found = parse_routes(body)
    return found[0] if found else None


def parse_routes(body: Any) -> list[dict[str, Any]]:
    """Every route of the answer (the best, then the alternatives)."""
    routes = body.get("routes") if isinstance(body, dict) else None
    out = []
    for r in routes or []:
        one = _parse_one(r) if isinstance(r, dict) else None
        if one:
            out.append(one)
    return out


def _parse_one(r: dict) -> dict[str, Any] | None:
    """A TomTom route → the card's: points [lon, lat], length, time, the
    instructions (where along the route, the French sentence, the kind of
    manoeuvre, road numbers, exit, direction) and its stretches: jams, limits,
    lanes, tolls, tunnels, ferries, motorways (as point indexes)."""
    coords: list[list[float]] = []
    # TomTom's point index (over all legs) → the index in `coords` (repeats dropped).
    index: list[int] = []
    for leg in r.get("legs") or []:
        for pt in (leg or {}).get("points") or []:
            try:
                q = [float(pt["longitude"]), float(pt["latitude"])]
            except (KeyError, TypeError, ValueError):
                index.append(max(0, len(coords) - 1))
                continue
            if not coords or coords[-1] != q:
                coords.append(q)
            index.append(len(coords) - 1)
    if len(coords) < 2:
        return None
    summary = r.get("summary") or {}
    steps = []
    for ins in ((r.get("guidance") or {}).get("instructions")) or []:
        if not isinstance(ins, dict):
            continue
        pt = ins.get("point") or {}
        try:
            loc = [float(pt["longitude"]), float(pt["latitude"])]
            at = float(ins.get("routeOffsetInMeters") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        steps.append(
            {
                "at": at,
                "loc": loc,
                "maneuver": str(ins.get("maneuver") or ""),
                "text": str(ins.get("message") or "")[:160],
                "road": str(ins.get("street") or "")[:80],
                "refs": [str(x) for x in ins.get("roadNumbers") or [] if x][:3],
                "exit": str(ins.get("exitNumber") or ins.get("roundaboutExitNumber") or ""),
                "to": str(ins.get("signpostText") or "")[:80],
            }
        )
    jams, limits, lanes = [], [], []
    spans: dict[str, list] = {"toll": [], "tunnel": [], "ferry": [], "motorway": []}
    for sec in r.get("sections") or []:
        if not isinstance(sec, dict):
            continue
        kind = str(sec.get("sectionType") or "").upper()
        try:
            a, b = int(sec["startPointIndex"]), int(sec["endPointIndex"])
        except (KeyError, TypeError, ValueError):
            continue
        if not index or a >= len(index):
            continue
        start, end = index[a], index[min(b, len(index) - 1)]
        if kind == "SPEED_LIMIT":
            try:
                v = int(round(float(sec.get("maxSpeedLimitInKmh") or 0)))
            except (TypeError, ValueError):
                v = 0
            if 5 <= v <= 200:
                limits.append({"start": start, "end": end, "v": v})
            continue
        if kind == "LANES":
            row = []
            for ln in sec.get("lanes") or []:
                if isinstance(ln, dict):
                    row.append({"dirs": [str(d) for d in ln.get("directions") or []][:4], "follow": str(ln.get("follow") or "")})
            if row:
                lanes.append({"start": start, "end": end, "lanes": row[:8]})
            continue
        name = {"TOLL_ROAD": "toll", "TOLL": "toll", "TUNNEL": "tunnel", "FERRY": "ferry", "MOTORWAY": "motorway"}.get(kind)
        if name:
            spans[name].append([start, end])
            continue
        if kind != "TRAFFIC":
            continue
        cat = str(sec.get("simpleCategory") or "").upper()
        magnitude = int(sec.get("magnitudeOfDelay") or 0) if str(sec.get("magnitudeOfDelay") or "0").isdigit() else 0
        # Slow (orange) or very slow (red): TomTom's magnitude, 3 and up, or a closed road, is red.
        level = 2 if magnitude >= 3 or cat == "ROAD_CLOSURE" else 1
        jams.append({"start": start, "end": end, "level": level,
                     "delay": int(sec.get("delayInSeconds") or 0), "kind": cat.lower()})
    return {
        "coords": coords,
        "jams": jams,
        "limits": limits,
        "lanes": lanes[:200],
        "tolls": spans["toll"],
        "tunnels": spans["tunnel"],
        "ferries": spans["ferry"],
        "motorways": spans["motorway"],
        "distance": float(summary.get("lengthInMeters") or 0),
        "duration": float(summary.get("travelTimeInSeconds") or 0),
        "delay": float(summary.get("trafficDelayInSeconds") or 0),
        "steps": steps,
    }
