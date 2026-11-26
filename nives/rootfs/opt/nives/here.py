"""HERE (platform.here.com), next to TomTom: the tolls' price of a route, and
a backup when TomTom does not answer — a route with its instructions, the
traffic incidents — plus the weather and the car parks at a destination.

Pure: the addresses, the queries and the reading of the answers; the calls
themselves are made by the integration (with the key, which never leaves
Home Assistant), within a daily cap.

HERE's public REST addresses: Routing v8, Traffic v7, Geocoding & Search v1,
Destination Weather v3. An answer that does not read as expected gives
nothing (never an invented figure): `here_check` says which service answers.
"""

from __future__ import annotations

import math
from typing import Any

ROUTES_URL = "https://router.hereapi.com/v8/routes"
INCIDENTS_URL = "https://data.traffic.hereapi.com/v7/incidents"
DISCOVER_URL = "https://discover.search.hereapi.com/v1/discover"
GEOCODE_URL = "https://geocode.search.hereapi.com/v1/geocode"
WEATHER_URL = "https://weather.hereapi.com/v3/report"

# TomTom's « avoid » words → HERE's avoid[features].
AVOID = {"motorways": "controlledAccessHighway", "tollRoads": "tollRoad", "ferries": "ferry", "unpavedRoads": "dirtRoad"}

# ----- the flexible polyline (HERE's encoding of a route's line) -----
_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_DECODE = {c: i for i, c in enumerate(_TABLE)}


def _varints(s: str):
    """The unsigned numbers of the string, 5 bits a character."""
    value, shift = 0, 0
    for ch in s:
        v = _DECODE.get(ch)
        if v is None:
            raise ValueError("not a flexible polyline")
        value |= (v & 0x1F) << shift
        if v & 0x20:
            shift += 5
        else:
            yield value
            value, shift = 0, 0
    if shift:
        raise ValueError("truncated flexible polyline")


def decode_polyline(s: str) -> list[list[float]]:
    """A flexible polyline → [[lon, lat], …] (a third dimension is read and dropped)."""
    it = _varints(str(s or ""))
    try:
        if next(it) != 1:
            raise ValueError("unknown flexible polyline version")
        header = next(it)
    except StopIteration:
        return []
    factor = 10 ** (header & 15)
    third = (header >> 4) & 7
    signed = lambda u: ~(u >> 1) if u & 1 else u >> 1  # noqa: E731
    out: list[list[float]] = []
    lat = lon = 0
    while True:
        try:
            lat += signed(next(it))
            lon += signed(next(it))
            if third:
                next(it)
        except StopIteration:
            break
        out.append([lon / factor, lat / factor])
    return out


def encode_polyline(coords: list[list[float]], precision: int = 5) -> str:
    """[[lon, lat], …] → a flexible polyline (for the tests and the route checks)."""
    def uvar(v: int) -> str:
        out = ""
        while v > 0x1F:
            out += _TABLE[(v & 0x1F) | 0x20]
            v >>= 5
        return out + _TABLE[v]

    def svar(v: int) -> str:
        return uvar(v << 1) if v >= 0 else uvar(((~v) << 1) | 1)

    factor = 10 ** precision
    s = uvar(1) + uvar(precision)
    plat = plon = 0
    for lon, lat in coords:
        ilat, ilon = round(lat * factor), round(lon * factor)
        s += svar(ilat - plat) + svar(ilon - plon)
        plat, plon = ilat, ilon
    return s


# ----- routes: the tolls, and the backup route -----
def route_params(
    key: str,
    origin: tuple[float, float],
    dest: tuple[float, float],
    via: list | tuple = (),
    avoid: list | tuple = (),
    full: bool = False,
) -> list[tuple[str, str]]:
    """The query (origin, dest, via as (lat, lon)); `via` passed through
    without stopping. `full`: the line and the instructions too (a backup
    route), else only what the tolls need."""
    ret = "summary,tolls" + (",polyline,actions,instructions" if full else "")
    params = [
        ("transportMode", "car"),
        ("origin", f"{origin[0]:.6f},{origin[1]:.6f}"),
        ("destination", f"{dest[0]:.6f},{dest[1]:.6f}"),
        ("return", ret),
        ("currency", "EUR"),
        ("lang", "fr-FR"),
        ("apikey", key),
    ]
    params += [("via", f"{v[0]:.6f},{v[1]:.6f}!passThrough=true") for v in via]
    feats = [AVOID[a] for a in avoid if a in AVOID]
    if feats:
        params.append(("avoid[features]", ",".join(feats)))
    return params


def _dist(a: list[float], b: list[float]) -> float:
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    y = math.radians(b[1] - a[1])
    return math.hypot(x, y) * 6371008.8


def shape_points(coords: list[list[float]], most: int = 20, skip_m: float = 2000.0) -> list[tuple[float, float]]:
    """A route's line → up to `most` points along it (lat, lon), evenly spread,
    away from both ends: given to HERE as « pass through », they keep its
    route on the same roads (the tolls of that route, not another)."""
    if len(coords) < 3:
        return []
    cum = [0.0]
    for i in range(1, len(coords)):
        cum.append(cum[-1] + _dist(coords[i - 1], coords[i]))
    total = cum[-1]
    if total < 2 * skip_m + 1000:
        return []
    n = max(1, min(most, int((total - 2 * skip_m) / 8000)))
    out, j = [], 0
    for k in range(1, n + 1):
        at = skip_m + (total - 2 * skip_m) * k / (n + 1)
        while j < len(cum) - 1 and cum[j + 1] < at:
            j += 1
        p = coords[j]
        out.append((p[1], p[0]))
    return out


def _price(fare: dict) -> float | None:
    p = (fare or {}).get("price") or {}
    try:
        if p.get("type") == "range":
            return float(p.get("minValue"))
        return float(p.get("value"))
    except (TypeError, ValueError):
        return None


def toll_cost(body: Any) -> dict | None:
    """HERE's first route → {"eur": total, "count": tolls, "systems": […]};
    each toll at its cheapest fare (cash and card alike). None: no route
    read; {"eur": 0} when the route has no toll."""
    routes = body.get("routes") if isinstance(body, dict) else None
    if not routes or not isinstance(routes[0], dict):
        return None
    total, count, systems, currency = 0.0, 0, [], "EUR"
    for sec in routes[0].get("sections") or []:
        for toll in (sec or {}).get("tolls") or []:
            prices = [x for x in (_price(f) for f in (toll or {}).get("fares") or []) if x is not None]
            if not prices:
                continue
            total += min(prices)
            count += 1
            for f in toll.get("fares") or []:
                currency = str(((f or {}).get("price") or {}).get("currency") or currency)
            name = str((toll or {}).get("tollSystem") or (toll or {}).get("countryCode") or "")
            if name and name not in systems:
                systems.append(name)
    return {"eur": round(total, 2), "count": count, "systems": systems[:4], "currency": currency}


# HERE's action → TomTom's word for it (the card draws its icon from it).
def _maneuver(a: dict) -> str:
    act, d = str(a.get("action") or ""), str(a.get("direction") or "")
    sev = str(a.get("severity") or "")
    side = "LEFT" if d == "left" else "RIGHT" if d == "right" else ""
    if act == "depart":
        return "DEPART"
    if act == "arrive":
        return "ARRIVE" + ("_" + side if side else "")
    if act in ("roundaboutEnter", "roundaboutPass", "roundaboutExit"):
        return "ROUNDABOUT_" + (side or "RIGHT")
    if act == "uTurn":
        return "MAKE_UTURN"
    if act in ("exit",):
        return "MOTORWAY_EXIT_" + (side or "RIGHT")
    if act in ("ramp", "enterHighway"):
        return "ENTER_MOTORWAY"
    if act == "keep":
        return "KEEP_" + side if side else "STRAIGHT"
    if act == "turn":
        if not side:
            return "STRAIGHT"
        return ("SHARP_" if sev == "heavy" else "BEAR_" if sev == "light" else "TURN_") + side
    if act == "continue":
        return "STRAIGHT"
    return "STRAIGHT"


def parse_route(body: Any) -> dict | None:
    """HERE's first route → the card's route (the same shape as TomTom's:
    points [lon, lat], length, time, delay, the instructions placed by their
    point), its tolls' price added. No traffic stretches (HERE's route says
    the delay as a whole)."""
    routes = body.get("routes") if isinstance(body, dict) else None
    if not routes or not isinstance(routes[0], dict):
        return None
    coords: list[list[float]] = []
    steps: list[dict] = []
    length = duration = base = 0.0
    for sec in routes[0].get("sections") or []:
        try:
            line = decode_polyline((sec or {}).get("polyline") or "")
        except ValueError:
            return None
        for p in line:
            if not coords or coords[-1] != p:
                coords.append(p)
        summ = (sec or {}).get("summary") or {}
        length += float(summ.get("length") or 0)
        duration += float(summ.get("duration") or 0)
        base += float(summ.get("baseDuration") or summ.get("duration") or 0)
        for a in (sec or {}).get("actions") or []:
            if not isinstance(a, dict):
                continue
            try:
                off = int(a.get("offset") or 0)
            except (TypeError, ValueError):
                off = 0
            if not line:
                continue
            loc = line[max(0, min(off, len(line) - 1))]
            exit_n = a.get("exit")
            steps.append({
                "at": 0.0, "loc": loc, "maneuver": _maneuver(a),
                "text": str(a.get("instruction") or "")[:160],
                "road": "", "refs": [], "exit": str(exit_n) if exit_n else "", "to": "",
            })
    if len(coords) < 2:
        return None
    toll = toll_cost(body)
    return {
        "coords": coords, "jams": [], "limits": [], "lanes": [], "tolls": [], "tunnels": [], "ferries": [],
        "motorways": [], "lez": [], "distance": length, "duration": duration,
        "delay": max(0.0, duration - base), "steps": steps, "toll_eur": toll["eur"] if toll else None,
        "source": "here",
    }


# ----- traffic incidents (the backup of TomTom's) -----
def incidents_params(key: str, lat: float, lon: float, radius_km: float) -> dict[str, str]:
    return {"in": f"circle:{lat:.5f},{lon:.5f};r={int(radius_km * 1000)}", "locationReferencing": "shape", "apikey": key}


_KINDS = {
    "accident": ("accident", "Accident"), "construction": ("works", "Travaux"), "roadClosure": ("closed", "Route fermée"),
    "laneRestriction": ("lane", "Voie fermée"), "congestion": ("jam", "Bouchon"), "disabledVehicle": ("danger", "Véhicule arrêté"),
    "roadHazard": ("danger", "Danger"), "weather": ("danger", "Météo"), "plannedEvent": ("works", "Événement"),
    "massTransit": ("danger", "Transports"), "other": ("danger", "Incident"),
}


def parse_incidents(body: Any) -> list[dict[str, Any]]:
    """HERE's incidents → the card's (the same fields as TomTom's), the worst first."""
    out: list[dict[str, Any]] = []
    for r in (body.get("results") if isinstance(body, dict) else None) or []:
        if not isinstance(r, dict):
            continue
        det = r.get("incidentDetails") or {}
        line: list[list[float]] = []
        for link in (((r.get("location") or {}).get("shape") or {}).get("links")) or []:
            for p in (link or {}).get("points") or []:
                try:
                    q = [float(p["lng"]), float(p["lat"])]
                except (KeyError, TypeError, ValueError):
                    continue
                if not line or line[-1] != q:
                    line.append(q)
        if not line:
            continue
        closed = bool(det.get("roadClosed"))
        kind, label = _KINDS.get(str(det.get("type") or "other"), _KINDS["other"])
        if closed:
            kind, label = "closed", "Route fermée"
        crit = {"critical": 4, "major": 3, "minor": 2, "low": 1}.get(str(det.get("criticality") or ""), 0)
        text = str(((det.get("description") or {}).get("value")) or ((det.get("summary") or {}).get("value")) or label)
        out.append({"id": str(det.get("id") or len(out)), "kind": kind, "label": label, "closed": kind == "closed",
                    "text": text[:120], "from": "", "to": "", "roads": [], "delay": 0, "magnitude": crit, "line": line})
    order = {"closed": 0, "accident": 1, "danger": 2, "lane": 3, "works": 4, "jam": 5}
    out.sort(key=lambda i: (order.get(i["kind"], 6), -i["magnitude"]))
    return out[:150]


# ----- places: car parks around a point, an address -----
def discover_params(key: str, q: str, lat: float, lon: float, limit: int = 8) -> dict[str, str]:
    return {"q": q, "at": f"{lat:.6f},{lon:.6f}", "limit": str(limit), "lang": "fr-FR", "apikey": key}


def parse_places(body: Any) -> list[dict[str, Any]]:
    out = []
    for it in (body.get("items") if isinstance(body, dict) else None) or []:
        pos = (it or {}).get("position") or {}
        try:
            lat, lon = float(pos["lat"]), float(pos["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        hours = [str(h.get("text") if isinstance(h.get("text"), str) else "; ".join(h.get("text") or []))
                 for h in (it.get("openingHours") or []) if isinstance(h, dict)]
        out.append({"name": str(it.get("title") or "")[:80], "lat": lat, "lon": lon,
                    "address": str(((it.get("address") or {}).get("label")) or "")[:120],
                    "distance_m": it.get("distance"), "hours": hours[0][:120] if hours else ""})
    return out


# ----- the weather at a point -----
def weather_params(key: str, lat: float, lon: float) -> dict[str, str]:
    return {"products": "observation,forecastHourly", "location": f"{lat:.5f},{lon:.5f}", "lang": "fr", "apikey": key}


def _num(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def condition(icon: str, text: str, night: bool = False) -> str:
    """HERE's icon and words → Home Assistant's weather condition."""
    s = f"{icon} {text}".lower()
    rules = (
        (("tstorm", "thunder", "orage"), "lightning-rainy"),
        (("sleet", "freezing", "grésil", "verglas", "ice"), "snowy-rainy"),
        (("snow", "neige", "flurr"), "snowy"),
        (("heavy_rain", "heavy rain", "forte pluie", "pluies fortes", "downpour"), "pouring"),
        (("rain", "drizzle", "shower", "pluie", "averse", "bruine"), "rainy"),
        (("fog", "haze", "mist", "brouillard", "brume"), "fog"),
        (("wind", "venteux", "vent fort"), "windy"),
        (("partly", "mostly_sunny", "mostly sunny", "few_cloud", "scattered", "éclaircie", "partiellement", "passages nuageux"), "partlycloudy"),
        (("cloud", "overcast", "couvert", "nuage"), "cloudy"),
        (("clear", "sunny", "soleil", "ensoleillé", "dégagé"), "clear-night" if night or "night" in s else "sunny"),
    )
    for words, cond in rules:
        if any(w in s for w in words):
            return cond
    return "cloudy"


def _one(o: dict) -> dict:
    icon, text = str(o.get("iconName") or ""), str(o.get("description") or o.get("skyDesc") or "")
    rain = _num(o.get("precipitation1H"))
    if rain is None:
        rain = _num(o.get("rainFall"))
    vis = _num(o.get("visibility"))
    return {
        "time": str(o.get("time") or ""), "temp": _num(o.get("temperature")), "text": text[:60], "icon": icon,
        "condition": condition(icon, text, bool(o.get("daylight") == "N")),
        "rain_pct": _num(o.get("precipitationProbability")), "rain_mm": rain, "snow_cm": _num(o.get("snowFall")),
        "wind_kmh": _num(o.get("windSpeed")), "gust_kmh": _num(o.get("windGust") if o.get("windGust") is not None else o.get("windGustSpeed")),
        "humidity": _num(o.get("humidity")), "visibility_km": vis,
    }


def parse_weather(body: Any) -> dict | None:
    """The observation now and the next hours → {now, hours, place}."""
    places = body.get("places") if isinstance(body, dict) else None
    if not places:
        return None
    pl = places[0] or {}
    obs = (pl.get("observations") or [{}])[0] or {}
    hours = []
    for f in pl.get("hourlyForecasts") or []:
        for o in (f or {}).get("forecasts") or []:
            if isinstance(o, dict):
                hours.append(_one(o))
    if not obs and not hours:
        return None
    place = ((obs.get("place") or {}).get("address") or {}) if obs else {}
    return {"now": _one(obs) if obs else None, "hours": hours[:24], "place": str(place.get("city") or "")[:60]}


def at_time(w: dict, epoch_s: float) -> dict | None:
    """The forecast hour nearest a moment (the observation within the next half hour)."""
    import datetime as _dt

    if not w:
        return None
    now = _dt.datetime.now(_dt.timezone.utc).timestamp()
    if w.get("now") and epoch_s - now < 1800:
        return w["now"]
    best, bd = None, None
    for h in w.get("hours") or []:
        try:
            t = _dt.datetime.fromisoformat(str(h.get("time")).replace("Z", "+00:00")).timestamp()
        except ValueError:
            continue
        d = abs(t - epoch_s)
        if bd is None or d < bd:
            best, bd = h, d
    return best or w.get("now")


def hazard(x: dict | None) -> dict | None:
    """What troubles the driving in a forecast: {"kind", "label", "advice"}, else None.
    storm, snow, ice (≤ 1 °C with water), rain (moderate or more), fog, wind."""
    if not x:
        return None
    c, t = x.get("condition"), x.get("temp")
    rain, pct = x.get("rain_mm") or 0, x.get("rain_pct") or 0
    wet = rain > 0.2 or pct >= 60 or c in ("rainy", "pouring", "snowy", "snowy-rainy")
    vis, wind, gust = x.get("visibility_km"), x.get("wind_kmh") or 0, x.get("gust_kmh") or 0
    if c == "lightning-rainy":
        return {"kind": "storm", "label": "Orage", "advice": "s'arrêter sur une aire en cas de grêle"}
    if c in ("snowy", "snowy-rainy") or (x.get("snow_cm") or 0) > 0:
        return {"kind": "snow", "label": "Neige" if c == "snowy" else "Pluie et neige", "advice": "route glissante, vitesse réduite"}
    if t is not None and t <= 1 and wet:
        return {"kind": "ice", "label": "Risque de verglas", "advice": "route glissante, freinage doux"}
    if c == "pouring" or rain >= 1.5 or (c == "rainy" and pct >= 60):
        return {"kind": "rain", "label": "Forte pluie" if (c == "pouring" or rain >= 4) else "Pluie", "advice": "distances doublées"}
    if c == "fog" or (vis is not None and vis < 1):
        return {"kind": "fog", "label": "Brouillard", "advice": "feux de brouillard, 50 km/h sous 50 m de visibilité"}
    if wind >= 60 or gust >= 70:
        return {"kind": "wind", "label": "Vent fort", "advice": "tenir le volant, prudence aux camions"}
    return None
