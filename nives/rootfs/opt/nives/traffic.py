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
