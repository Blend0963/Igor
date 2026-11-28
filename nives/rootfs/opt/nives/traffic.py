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
import re
from typing import Any

INCIDENTS_URL = "https://api.tomtom.com/traffic/services/5/incidentDetails"
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


def _num(v):
    """A number, or None."""
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None


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


# ----- a route that knows the traffic: TomTom Routing (same key) -----
ROUTE_URL = "https://api.tomtom.com/routing/1/calculateRoute/{a}:{b}/json"
MAX_AVOID = 10


# What a route can be asked to keep off (the card's « éviter » choices).
AVOIDABLE = {"motorways", "tollRoads", "ferries", "unpavedRoads", "lowEmissionZones"}
# The stretches TomTom marks along a route: the traffic, the limits, the lanes
# to take, and what lies on the way (tolls, tunnels, ferries, motorways, the
# low-emission zones — the ZFE a vignette may not enter).
SECTION_TYPES = ("traffic", "speedLimit", "lanes", "tollRoad", "tunnel", "ferry", "motorway", "lowEmissionZone")


# The ways one travels: the card's word → TomTom's travelMode.
TRAVEL_MODES = {"car": "car", "pedestrian": "pedestrian", "bicycle": "bicycle"}


def route_params(
    key: str, heading: float | None, avoid: list[str] | tuple = (), alternatives: int = 0, route_type: str = "fastest",
    mode: str = "car",
) -> list[tuple[str, str]]:
    """The query as pairs (sectionType and avoid repeat). On foot or by bike:
    no traffic, no heading, nothing to avoid (TomTom's own paths)."""
    car = TRAVEL_MODES.get(mode, "car") == "car"
    params = [
        ("key", key),
        ("traffic", "true" if car else "false"),
        ("travelMode", TRAVEL_MODES.get(mode, "car")),
        ("routeType", route_type if route_type in ("fastest", "shortest") else "fastest"),
        ("instructionsType", "text"),
        ("language", "fr-FR"),
        ("routeRepresentation", "polyline"),
    ]
    if not car:
        if alternatives > 0:
            params.append(("maxAlternatives", str(min(2, int(alternatives)))))
        return params
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
                # The junction view: the turn's angle (right positive) and its kind.
                "angle": _num(ins.get("turnAngleInDecimalDegrees")),
                "junction": str(ins.get("junctionType") or ""),
            }
        )
    jams, limits, lanes = [], [], []
    spans: dict[str, list] = {"toll": [], "tunnel": [], "ferry": [], "motorway": [], "lez": []}
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
        name = {"TOLL_ROAD": "toll", "TOLL": "toll", "TUNNEL": "tunnel", "FERRY": "ferry", "MOTORWAY": "motorway", "LOW_EMISSION_ZONE": "lez"}.get(kind)
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
        "lez": spans["lez"],
        "distance": float(summary.get("lengthInMeters") or 0),
        "duration": float(summary.get("travelTimeInSeconds") or 0),
        "delay": float(summary.get("trafficDelayInSeconds") or 0),
        "steps": steps,
    }


# ----- the line drawn: the same way, on TomTom Orbis (the map shown) -----
# The route above comes from TomTom's classic routing, made on its older map;
# the card shows TomTom Orbis, which draws some roads otherwise (a boulevard
# as two carriageways where the older map has one middle line). Orbis is
# asked to rebuild the same way (the classic route's points as supporting
# points) and its line replaces the classic one: every stretch of the classic
# answer (jams, limits, lanes, tolls…) is carried onto it by place, the
# instructions keep their own places. Everything else stays the classic
# route's: the voice, the times, the traffic.
ORBIS_ROUTE_URL = "https://api.tomtom.com/maps/orbis/routing/calculateRoute/{a}:{b}/json"
# How far the classic line may stray from Orbis' (metres) before the Orbis
# line is refused (not the same way), and the share of points allowed past it.
ORBIS_MATCH_M = 60.0
ORBIS_MATCH_SHARE = 0.03


def orbis_url(origin: tuple[float, float], dest: tuple[float, float], via: list | tuple = ()) -> str:
    return route_url(origin, dest, via).replace(ROUTE_URL.split("{")[0], ORBIS_ROUTE_URL.split("{")[0])


def orbis_params(key: str, avoid: list[str] | tuple = ()) -> list[tuple[str, str]]:
    params = [("key", key), ("apiVersion", "2"), ("travelMode", "car")]
    params += [("avoid", a) for a in avoid if a in AVOIDABLE]
    return params


def _dist(a: list[float], b: list[float]) -> float:
    """Metres between two [lon, lat] points."""
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    y = math.radians(b[1] - a[1])
    return math.hypot(x, y) * 6371008.8


def orbis_body(coords: list[list[float]], every_m: float = 80.0, most: int = 1500) -> dict[str, Any]:
    """The classic route as supporting points (one every ~80 m, at most 1500)."""
    if len(coords) < 2:
        return {}
    total = sum(_dist(coords[i - 1], coords[i]) for i in range(1, len(coords)))
    step = max(every_m, total / most)
    pts, run = [coords[0]], 0.0
    for i in range(1, len(coords)):
        run += _dist(coords[i - 1], coords[i])
        if run >= step:
            pts.append(coords[i]); run = 0.0
    if pts[-1] != coords[-1]:
        pts.append(coords[-1])
    return {"supportingPoints": [{"latitude": p[1], "longitude": p[0]} for p in pts]}


def orbis_coords(body: Any) -> list[list[float]]:
    """Orbis' first route as [lon, lat] points (repeats dropped)."""
    routes = body.get("routes") if isinstance(body, dict) else None
    out: list[list[float]] = []
    for leg in ((routes or [{}])[0] or {}).get("legs") or []:
        for pt in (leg or {}).get("points") or []:
            try:
                q = [float(pt["longitude"]), float(pt["latitude"])]
            except (KeyError, TypeError, ValueError):
                continue
            if not out or out[-1] != q:
                out.append(q)
    return out


def _on_line(p: list[float], a: list[float], b: list[float]) -> tuple[float, float]:
    """(distance in metres, t along a→b) of p's foot on the segment."""
    k = math.cos(math.radians(p[1]))
    ax, ay, bx, by = (a[0] - p[0]) * k, a[1] - p[1], (b[0] - p[0]) * k, b[1] - p[1]
    dx, dy = bx - ax, by - ay
    ln = dx * dx + dy * dy
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / ln)) if ln else 0.0
    return math.hypot(ax + t * dx, ay + t * dy) * 111195.0, t


def onto_orbis(route: dict[str, Any], line: list[list[float]]) -> dict[str, Any] | None:
    """The classic route with Orbis' line: each classic point's index → the
    Orbis point at the same place (walking forward along both, so a road
    taken twice keeps its order). None when the two are not the same way."""
    old = route.get("coords") or []
    if len(old) < 2 or len(line) < 2:
        return None
    total_old = sum(_dist(old[i - 1], old[i]) for i in range(1, len(old)))
    total_new = sum(_dist(line[i - 1], line[i]) for i in range(1, len(line)))
    if not total_old or not (0.85 <= total_new / total_old <= 1.15):
        return None
    mapped, far, j = [], 0, 1
    for p in old:
        best = None
        for k in range(max(1, j - 3), min(len(line), j + 400)):
            d, t = _on_line(p, line[k - 1], line[k])
            if best is None or d < best[0]:
                best = (d, k, t)
            if best[0] < 15.0 and k > best[1] + 30:
                break
        d, k, t = best
        if d > ORBIS_MATCH_M:
            far += 1
        j = k
        mapped.append(k if t >= 0.5 else k - 1)
    if far > max(2, ORBIS_MATCH_SHARE * len(old)):
        return None
    n = len(line) - 1
    at = lambda i: min(n, mapped[max(0, min(int(i), len(mapped) - 1))])  # noqa: E731

    def span(x: dict) -> dict:
        y = dict(x)
        y["start"], y["end"] = at(x["start"]), max(at(x["start"]), at(x["end"]))
        return y

    out = dict(route)
    out["coords"] = line
    for key in ("jams", "limits", "lanes"):
        out[key] = [span(x) for x in route.get(key) or []]
    for key in ("tolls", "tunnels", "ferries", "motorways", "lez"):
        out[key] = [[at(a), max(at(a), at(b))] for a, b in route.get(key) or []]
    out["geometry"] = "orbis"
    return out


# ----- the basemap: TomTom's dark raster map, relayed with the same key -----
# The card never sees the key: it asks /api/nives/basemap/{z}/{x}/{y}.png
# (Home Assistant, logged in), which asks TomTom. Pre-drawn 512 px PNG = nothing
# for the head unit to compute. TomTom has three generations of this API; the
# first that answers with a picture is kept for the following tiles.
BASEMAP_URLS = (
    # Orbis Maps v2
    "https://api.tomtom.com/maps/orbis/display/raster/tile/{z}/{x}/{y}"
    "?apiVersion=2&style=street-dark&tileSize=512&key={key}",
    # Orbis Maps v1
    "https://api.tomtom.com/maps/orbis/map-display/tile/{z}/{x}/{y}.png"
    "?apiVersion=1&style=street-dark&tileSize=512&key={key}",
    # TomTom Maps (Genesis): the « night » style
    "https://api.tomtom.com/map/1/tile/basic/night/{z}/{x}/{y}.png?tileSize=512&key={key}",
)
BASEMAP_MAXZOOM = 22


def basemap_urls(key: str, z: int, x: int, y: int, first: int = 0) -> list[tuple[int, str]]:
    """The tile's addresses, the one known to work first: [(index, url), …]."""
    order = [first] + [i for i in range(len(BASEMAP_URLS)) if i != first]
    return [(i, BASEMAP_URLS[i].format(z=z, x=x, y=y, key=key)) for i in order]


def tile_ok(z: int, x: int, y: int) -> bool:
    """A real tile address (no request to TomTom for nonsense)."""
    return 0 <= z <= BASEMAP_MAXZOOM and 0 <= x < 2 ** z and 0 <= y < 2 ** z


# ----- the 3D map (phone): TomTom's vector style, relayed whole -----
# A vector map is more than pictures: a style, its tiles, fonts and icons, all
# at api.tomtom.com and all wanting the key. Home Assistant relays every one of
# them under /api/nives/tomtom/…, adds the key on the way out, and rewrites the
# addresses inside the JSON it relays so the browser never meets TomTom (nor
# the key). Two generations of style; the first that answers is kept.
TOMTOM_HOST = "https://api.tomtom.com/"
STYLE_PATHS = (
    # Orbis Maps, dark, made for driving — the style version TomTom's own
    # Maps SDK asks for (its 3D buildings drawn by MapLibre 6)
    "maps/orbis/assets/styles/0.6.0-0/style.json?apiVersion=1&map=basic_street-dark-driving",
    # Orbis Maps (street, dark)
    "maps/orbis/assets/styles/0.*/style.json?apiVersion=1&map=basic_street-dark",
    # TomTom Maps (Genesis), dark
    "style/1/style/22.2.1-*?map=2/basic_street-dark",
)
# Only these corners of api.tomtom.com go through the relay (maps, not every API).
RELAY_PREFIXES = ("maps/", "map/", "style/", "traffic/map/4/tile/flow/")

_KEY_RE = re.compile(r"([?&])key=[^&\"'\s]*(&)?")


def strip_key(url: str) -> str:
    """An address without its key= (the relay puts it back)."""
    return _KEY_RE.sub(lambda m: m.group(1) if m.group(2) else "", url)


def with_key(path_query: str, key: str) -> str:
    """api.tomtom.com/<path?query> with the key."""
    pq = strip_key(path_query)
    return TOMTOM_HOST + pq + ("&" if "?" in pq else "?") + "key=" + key


def relay_ok(path: str) -> bool:
    return path.startswith(RELAY_PREFIXES) and ".." not in path


def rewrite_json(text: str, base: str) -> str:
    """TomTom's addresses → the relay's (base ends with '/'), keys removed."""
    text = text.replace("https:\\/\\/api.tomtom.com\\/", TOMTOM_HOST)
    out, i = [], 0
    while True:
        j = text.find(TOMTOM_HOST, i)
        if j < 0:
            out.append(text[i:])
            return "".join(out)
        out.append(text[i:j])
        k = j
        while k < len(text) and text[k] not in "\"' \n":
            k += 1
        out.append(base + strip_key(text[j + len(TOMTOM_HOST):k]))
        i = k
