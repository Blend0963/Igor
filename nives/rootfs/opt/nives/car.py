"""The car's guidance, driven by Igor: go somewhere, find a fuel station (or
any place) on the way, stop there.

The GPS card (igor-wall.js, igor-gps-card) guides to what is written in an
input_text, « lat,lon;Name », and, with a stop on the way, « …|lat,lon;Stop ».
These helpers write it, and answer what Igor needs to tell the driver: where a
place is, how far along the way, whether it is on the motorway (in a service
area) and how many minutes it adds to the trip.

Everything comes from free OpenStreetMap services: Nominatim (places),
Overpass (what is around), OSRM (routes). Network access goes through a
`fetch(method, url, params, data)` callable, so it can be tested offline.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Awaitable, Callable, Sequence
from typing import Any

NOMINATIM = "https://nominatim.openstreetmap.org/search"
OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
OSRM = "https://router.project-osrm.org/route/v1/driving/"
TOMTOM_ALONG = "https://api.tomtom.com/search/2/searchAlongRoute/{q}.json"
TOMTOM_NEARBY = "https://api.tomtom.com/search/2/categorySearch/{q}.json"
# With the TomTom key: TomTom's places (brands, opening hours, the detour it
# works out itself), the words it searches and its category ids where known.
TOMTOM_KINDS: dict[str, tuple[str, str]] = {
    "fuel": ("petrol station", "7311"),
    "charging": ("electric vehicle station", "7309"),
    "rest": ("rest area", "7395"),
    "hospital": ("hospital", "7321"),
    "pharmacy": ("pharmacy", "9565"),
    "atm": ("cash dispenser", "7397"),
    "restaurant": ("restaurant", "7315"),
    "cafe": ("cafe", ""),
    "supermarket": ("supermarket", ""),
    "toilets": ("toilets", ""),
    "parking": ("parking", ""),
    "car_wash": ("car wash", ""),
    "car_repair": ("car repair", ""),
}
MAX_TEXT = 120

# What Igor can look for, as Overpass filters (each one or more statements).
KINDS: dict[str, tuple[str, list[str]]] = {
    "fuel": ("station-service", ['nwr["amenity"="fuel"]']),
    "charging": ("borne de recharge", ['nwr["amenity"="charging_station"]']),
    "parking": ("parking", ['nwr["amenity"="parking"]["access"!~"^(private|no|customers)$"]']),
    "rest": ("aire de repos", ['nwr["highway"~"^(rest_area|services)$"]']),
    "toilets": ("toilettes", ['nwr["amenity"="toilets"]']),
    "hospital": ("hôpital", ['nwr["amenity"="hospital"]']),
    "pharmacy": ("pharmacie", ['nwr["amenity"="pharmacy"]']),
    "atm": ("distributeur", ['nwr["amenity"="atm"]', 'nwr["amenity"="bank"]["atm"="yes"]']),
    "supermarket": ("supermarché", ['nwr["shop"="supermarket"]']),
    "restaurant": ("restaurant", ['nwr["amenity"~"^(restaurant|fast_food)$"]']),
    "cafe": ("café", ['nwr["amenity"="cafe"]']),
    "car_wash": ("station de lavage", ['nwr["amenity"="car_wash"]']),
    "car_repair": ("garage", ['nwr["shop"="car_repair"]']),
}
# Words a driver says → the kind.
KIND_WORDS = {
    "essence": "fuel", "carburant": "fuel", "station": "fuel", "gasoil": "fuel", "gazole": "fuel", "diesel": "fuel",
    "station-service": "fuel", "station service": "fuel", "plein": "fuel", "gas": "fuel",
    "recharge": "charging", "borne": "charging", "electrique": "charging",
    "aire": "rest", "repos": "rest", "pause": "rest",
    "wc": "toilets", "toilette": "toilets",
    "hopital": "hospital", "urgences": "hospital",
    "pharmacie": "pharmacy", "distributeur": "atm", "banque": "atm", "dab": "atm",
    "supermarche": "supermarket", "courses": "supermarket", "manger": "restaurant", "restaurant": "restaurant",
    "cafe": "cafe", "lavage": "car_wash", "garage": "car_repair", "parking": "parking",
}
HOME_WORDS = {"maison", "domicile", "home", "chez moi", "a la maison", "chez nous", "la maison"}

Fetch = Callable[[str, str, dict | None, Any], Awaitable[Any]]


def fold(text: str) -> str:
    """Lower case, no accents, single spaces."""
    t = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t).strip()


def kind_of(text: str) -> str | None:
    t = fold(text).replace("_", " ")
    if t.replace(" ", "_") in KINDS:
        return t.replace(" ", "_")
    for word, kind in KIND_WORDS.items():
        if word in t:
            return kind
    return None


def haversine_m(a: Sequence[float], b: Sequence[float]) -> float:
    """Metres between two [lon, lat] points."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371000.0 * 2 * math.asin(min(1.0, math.sqrt(h)))


# ----- the input_text: « lat,lon;Name|lat,lon;Stop » -----
_POINT = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:;\s*(.*))?$")


def parse_point(text: str) -> dict | None:
    m = _POINT.match(str(text or ""))
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if abs(lat) > 90 or abs(lon) > 180:
        return None
    return {"lat": lat, "lon": lon, "name": (m.group(3) or "").strip() or "destination"}


def parse_destination(text: str) -> dict | None:
    """{lat, lon, name, via: [points]} or None."""
    parts = [p for p in str(text or "").split("|") if p.strip()]
    if not parts:
        return None
    dest = parse_point(parts[0])
    if not dest:
        return None
    dest["via"] = [v for v in (parse_point(p) for p in parts[1:]) if v]
    return dest


def format_destination(dest: dict, via: Sequence[dict] = ()) -> str:
    """The input_text's value, names shortened to fit 120 characters."""
    points = [dest, *via]
    coords = [f"{p['lat']:.6f},{p['lon']:.6f}" for p in points]
    room = MAX_TEXT - sum(len(c) + 1 for c in coords) - (len(points) - 1)
    each = max(0, room // len(points))
    names = [re.sub(r"[|;]", " ", str(p.get("name") or ""))[:each].strip() for p in points]
    return "|".join(f"{c};{n}" if n else c for c, n in zip(coords, names))[:MAX_TEXT]


# ----- the route -----
def route_points(route: dict) -> tuple[list[list[float]], list[float]]:
    """The route's [lon, lat] points and the distance (m) from its start to each."""
    coords = route.get("geometry", {}).get("coordinates") or []
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + haversine_m(coords[i - 1], coords[i]))
    return coords, cum


def motorway_spans(route: dict, coords: list, cum: list) -> list[tuple[float, float]]:
    """Where along the route (metres) the road is a motorway: OSRM's steps
    whose road is classed « motorway » or numbered A…/E…."""
    spans = []
    for leg in route.get("legs") or []:
        for st in leg.get("steps") or []:
            classes = {c for x in st.get("intersections") or [] for c in x.get("classes") or []}
            ref = str(st.get("ref") or "")
            if "motorway" in classes or re.match(r"^\s*A\s?\d", ref):
                g = st.get("geometry", {}).get("coordinates") or []
                if len(g) >= 2:
                    a, _ = locate(g[0], coords, cum)
                    b, _ = locate(g[-1], coords, cum)
                    spans.append((min(a, b), max(a, b)))
    return spans


def locate(p: Sequence[float], coords: list, cum: list) -> tuple[float, float]:
    """(metres along the route, metres off it) for a [lon, lat] point."""
    best = (0.0, float("inf"))
    if len(coords) < 2:
        return best
    k = math.cos(math.radians(p[1]))
    for i in range(1, len(coords)):
        ax, ay = coords[i - 1][0] * k, coords[i - 1][1]
        bx, by = coords[i][0] * k, coords[i][1]
        px, py = p[0] * k, p[1]
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        q = [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t]
        off = haversine_m(p, q)
        if off < best[1]:
            best = (cum[i - 1] + haversine_m(coords[i - 1], q), off)
    return best


def thin(coords: list, cum: list, upto_m: float, max_points: int = 120) -> list[list[float]]:
    """The route's first `upto_m` metres, in at most `max_points` points."""
    part = [c for c, d in zip(coords, cum) if d <= upto_m] or coords[:1]
    step = max(1, math.ceil(len(part) / max_points))
    out = part[::step]
    if out[-1] != part[-1]:
        out.append(part[-1])
    return out


def poi_query(kind: str, *, line: list | None = None, center: Sequence[float] | None = None, radius: float = 1500) -> str:
    """Overpass: the kind around the route's line (or a point), with the
    motorway service areas around, to tell which place is in one."""
    if line:
        where = "(around:%d,%s)" % (radius, ",".join(f"{p[1]:.5f},{p[0]:.5f}" for p in line))
    else:
        where = "(around:%d,%.6f,%.6f)" % (radius, center[1], center[0])
    stmts = "".join(f"{s}{where};" for s in KINDS[kind][1])
    areas = f'way["highway"~"^(services|rest_area)$"]{where};'
    return f"[out:json][timeout:25];({stmts});out center tags 200;({areas});out center tags bb 100;"


def parse_places(body: Any, kind: str) -> tuple[list[dict], list[dict]]:
    """Overpass' answer → (places, service areas with their box)."""
    places, areas = [], []
    filters = KINDS[kind][1]
    for e in (body or {}).get("elements") or []:
        tags = e.get("tags") or {}
        lat = e.get("lat", (e.get("center") or {}).get("lat"))
        lon = e.get("lon", (e.get("center") or {}).get("lon"))
        if lat is None or lon is None:
            continue
        if tags.get("highway") in ("services", "rest_area") and "bounds" in e:
            b = e["bounds"]
            areas.append({"name": tags.get("name") or "", "box": (b["minlon"], b["minlat"], b["maxlon"], b["maxlat"]),
                          "services": tags.get("highway") == "services"})
            if kind != "rest":
                continue
        if not _matches(tags, filters):
            continue
        name = tags.get("name") or tags.get("brand") or tags.get("operator") or KINDS[kind][0]
        places.append({
            "id": f"{e.get('type')}{e.get('id')}",
            "name": str(name)[:60],
            "brand": str(tags.get("brand") or "")[:40],
            "lat": float(lat), "lon": float(lon),
            "opening_hours": str(tags.get("opening_hours") or "")[:60],
            "city": str(tags.get("addr:city") or "")[:40],
        })
    return places, areas


def _matches(tags: dict, filters: list[str]) -> bool:
    for f in filters:
        ok = True
        for key, op, val in re.findall(r'\["([^"]+)"(=|~|!~)"([^"]*)"\]', f):
            v = str(tags.get(key, ""))
            if op == "=" and v != val:
                ok = False
            elif op == "~" and not re.search(val, v):
                ok = False
            elif op == "!~" and v and re.search(val, v):
                ok = False
        if ok:
            return True
    return False


def parse_tomtom(body: Any) -> list[dict]:
    """TomTom's search answer → places (with TomTom's detour in seconds when along a route)."""
    out = []
    for r in (body or {}).get("results") or []:
        pos = r.get("position") or {}
        poi = r.get("poi") or {}
        try:
            lat, lon = float(pos["lat"]), float(pos["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        brands = [b.get("name") for b in poi.get("brands") or [] if isinstance(b, dict) and b.get("name")]
        hours = poi.get("openingHours") or {}
        out.append({
            "id": str(r.get("id") or f"{lat},{lon}"),
            "name": str(poi.get("name") or (brands[0] if brands else "") or "")[:60],
            "brand": str(brands[0] if brands else "")[:40],
            "lat": lat, "lon": lon,
            "opening_hours": str(hours.get("mode") or "")[:60] if isinstance(hours, dict) else "",
            "city": str((r.get("address") or {}).get("municipality") or "")[:40],
            "detour_s": r.get("detourTime"),
        })
    return out


def in_area(p: dict, areas: list[dict]) -> dict | None:
    pad = 0.0015  # about 150 m around the area's box
    for a in areas:
        w, s, e, n = a["box"]
        if w - pad <= p["lon"] <= e + pad and s - pad <= p["lat"] <= n + pad:
            return a
    return None


class Car:
    """The car's guidance through the OpenStreetMap services (and TomTom's
    places when a key is given)."""

    def __init__(self, fetch: Fetch, tomtom_key: Callable[[], str | None] | None = None) -> None:
        self.fetch = fetch
        self.tomtom_key = tomtom_key or (lambda: None)

    async def tomtom_along(self, kind: str, line: list, key: str) -> list[dict]:
        """TomTom's places along the route (at most 15 minutes of detour)."""
        q, cat = TOMTOM_KINDS[kind]
        params = {"key": key, "maxDetourTime": "900", "limit": "15", "language": "fr-FR", "sortBy": "detourTime"}
        if cat:
            params["categorySet"] = cat
        body = {"route": {"points": [{"lat": p[1], "lon": p[0]} for p in line]}}
        return parse_tomtom(await self.fetch("POST", TOMTOM_ALONG.format(q=q.replace(" ", "%20")), params, None, body))

    async def tomtom_near(self, kind: str, car: Sequence[float], key: str) -> list[dict]:
        q, cat = TOMTOM_KINDS[kind]
        params = {"key": key, "lat": f"{car[1]:.6f}", "lon": f"{car[0]:.6f}", "radius": "15000", "limit": "10", "language": "fr-FR"}
        if cat:
            params["categorySet"] = cat
        return parse_tomtom(await self.fetch("GET", TOMTOM_NEARBY.format(q=q.replace(" ", "%20")), params, None))

    async def overpass(self, query: str) -> Any:
        last: Exception | None = None
        for url in OVERPASS:
            try:
                return await self.fetch("POST", url, None, {"data": query})
            except Exception as err:  # noqa: BLE001 - busy: the next mirror
                last = err
        raise last or RuntimeError("overpass")

    async def route(self, points: Sequence[Sequence[float]], steps: bool = True) -> dict | None:
        """OSRM's route through [lon, lat] points, or None."""
        path = ";".join(f"{p[0]:.6f},{p[1]:.6f}" for p in points)
        params = {"overview": "full", "geometries": "geojson", "steps": "true" if steps else "false"}
        body = await self.fetch("GET", OSRM + path, params, None)
        routes = (body or {}).get("routes") or []
        return routes[0] if routes else None

    async def geocode(self, query: str, near: Sequence[float] | None) -> list[dict]:
        params = {"format": "jsonv2", "limit": "5", "accept-language": "fr", "q": query}
        if near:
            params["viewbox"] = ",".join(f"{v:.4f}" for v in (near[0] - 1, near[1] + 1, near[0] + 1, near[1] - 1))
        rows = await self.fetch("GET", NOMINATIM, params, None) or []
        out = []
        for r in rows if isinstance(rows, list) else []:
            try:
                lat, lon = float(r["lat"]), float(r["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            parts = str(r.get("display_name") or "").split(", ")
            out.append({"lat": lat, "lon": lon, "name": str(r.get("name") or parts[0])[:60],
                        "address": ", ".join(parts[:4])[:160]})
        if near:
            out.sort(key=lambda p: haversine_m(near, (p["lon"], p["lat"])))
        return out

    async def nearby(self, kind: str, car: Sequence[float], dest: dict | None, count: int = 3) -> dict:
        """The places of a kind the driver can reach: along the route when
        guided (in order, with the minutes each adds), else the nearest by road."""
        label = KINDS[kind][0]
        if dest:
            target = [[v["lon"], v["lat"]] for v in dest.get("via") or []] + [[dest["lon"], dest["lat"]]]
            base = await self.route([car, *target])
            if base:
                coords, cum = route_points(base)
                total = cum[-1] if cum else 0
                line = thin(coords, cum, min(total, 150000))
                spans = motorway_spans(base, coords, cum)
                key = self.tomtom_key()
                if key:
                    try:
                        tt = await self.tomtom_along(kind, line, key)
                    except Exception:  # noqa: BLE001 - TomTom busy, refused: OpenStreetMap
                        tt = None
                    if tt:
                        return self._tomtom_result(tt, kind, label, dest, coords, cum, spans, base, count)
                body = await self.overpass(poi_query(kind, line=line, radius=1500))
                places, areas = parse_places(body, kind)
                cands = []
                for p in places:
                    along, off = locate((p["lon"], p["lat"]), coords, cum)
                    if along < 200:  # behind or right here
                        continue
                    area = in_area(p, areas)
                    motorway = bool(area) and any(a - 300 <= along <= b + 300 for a, b in spans)
                    cands.append({**p, "along_m": along, "off_m": off, "area": area, "motorway": motorway})
                cands.sort(key=lambda c: (c["along_m"] + 4 * c["off_m"]))
                out = []
                for c in cands[: count * 2]:
                    via = await self.route([car, [c["lon"], c["lat"]], *target], steps=False)
                    detour = max(0.0, ((via or {}).get("duration", 0) - base.get("duration", 0)) / 60) if via else None
                    out.append(self._place(c, detour, base))
                out.sort(key=lambda c: (c["detour_min"] is None, c["detour_min"] > 5 if c["detour_min"] is not None else True, c["distance_km"]))
                return {"ok": True, "kind": label, "guided": True, "destination": dest["name"],
                        "places": out[:count], "note": _note(out[:count], label)}
        # Not guided: around the car, nearest by road (TomTom's places first).
        key = self.tomtom_key()
        areas: list[dict] = []
        places: list[dict] = []
        if key:
            try:
                places = await self.tomtom_near(kind, car, key)
            except Exception:  # noqa: BLE001
                places = []
        for radius in (5000, 15000, 40000) if not places else ():
            body = await self.overpass(poi_query(kind, center=car, radius=radius))
            places, areas = parse_places(body, kind)
            if places:
                break
        places.sort(key=lambda p: haversine_m(car, (p["lon"], p["lat"])))
        out = []
        for p in places[: count * 2]:
            r = await self.route([car, [p["lon"], p["lat"]]], steps=False)
            area = in_area(p, areas)
            out.append({
                "name": p["name"], "brand": p["brand"], "lat": p["lat"], "lon": p["lon"],
                "distance_km": round(((r or {}).get("distance") or haversine_m(car, (p["lon"], p["lat"]))) / 1000, 1),
                "minutes": round(((r or {}).get("duration") or 0) / 60) if r else None,
                "service_area": (area or {}).get("name") or None,
                "opening_hours": p["opening_hours"] or None, "city": p["city"] or None,
            })
        out.sort(key=lambda c: (c["minutes"] is None, c["minutes"] or 0, c["distance_km"]))
        return {"ok": True, "kind": label, "guided": False, "places": out[:count],
                "note": f"aucun(e) {label} trouvé(e) à 40 km" if not out else ""}

    def _tomtom_result(self, tt, kind, label, dest, coords, cum, spans, base, count) -> dict:
        """TomTom's places along the route, in the order the car meets them,
        those that cost little first (TomTom's own detour)."""
        cands = []
        for p in tt:
            along, off = locate((p["lon"], p["lat"]), coords, cum)
            if along < 200:
                continue
            detour = (p.get("detour_s") or 0) / 60 if p.get("detour_s") is not None else None
            motorway = detour is not None and detour <= 1.5 and off < 300 and any(a - 300 <= along <= b + 300 for a, b in spans)
            area = {"name": p["name"]} if motorway and fold(p["name"]).startswith("aire") else None
            cands.append(self._place({**p, "along_m": along, "off_m": off, "area": area, "motorway": motorway}, detour, base))
        cands.sort(key=lambda c: (c["detour_min"] is None, (c["detour_min"] or 0) > 5, c["distance_km"]))
        return {"ok": True, "kind": label, "guided": True, "destination": dest["name"], "source": "tomtom",
                "places": cands[:count], "note": _note(cands[:count], label)}

    @staticmethod
    def _place(c: dict, detour: float | None, base: dict) -> dict:
        area = c["area"]
        return {
            "name": c["name"], "brand": c["brand"], "lat": c["lat"], "lon": c["lon"],
            "distance_km": round(c["along_m"] / 1000, 1),
            "minutes_away": round(base.get("duration", 0) * (c["along_m"] / max(1.0, base.get("distance", 1))) / 60),
            "detour_min": round(detour) if detour is not None else None,
            "on_route": detour is not None and detour <= 2,
            "motorway": c["motorway"],
            "service_area": (area or {}).get("name") or None,
            "off_route_m": round(c["off_m"]),
            "opening_hours": c["opening_hours"] or None, "city": c["city"] or None,
        }


def _note(places: list[dict], label: str) -> str:
    if not places:
        return f"aucun(e) {label} près de l'itinéraire"
    return ""
