"""Igor's own library of places: every point of interest OpenStreetMap knows
in metropolitan France (restaurants, views, monuments, shops, parkings,
stations, toilets…), gathered by Home Assistant itself and kept in one
SQLite file, so the map reads its places from the house and never from a
busy public server.

How it fills: France is cut into squares of 0.25° (about 28 × 18 km); each
square is asked of Overpass once, in the background, one at a time, with a
pause between two. A square that fails (Overpass busy, too much at once) is
cut in four or tried again later; nothing the map shows depends on it. Once
every square is in, each one is asked again after 30 days (the month's
changes). Without network, the library stays as it is.

Where: /share/igor/lieux.sqlite when Home Assistant has the shared folder
(it can be left out of the backups there), else <config>/nives_offline/.
Only the places: the map itself (TomTom's) is never stored — its licence
forbids it and its quota would not allow it.

Pure where it can be (the query, the reading of Overpass' answer, the
ranks): tested without Home Assistant.
"""

from __future__ import annotations

import json
import math
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

# Metropolitan France and Corsica.
FRANCE_BBOX = (-5.25, 41.25, 9.75, 51.25)
CELL = 0.25
MIN_CELL = 0.0625
REFRESH_S = 30 * 86400
OVERPASS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

AMENITY = (
    "restaurant|fast_food|food_court|cafe|bar|pub|biergarten|ice_cream|pharmacy|hospital|clinic|doctors|dentist|"
    "veterinary|parking|car_wash|car_rental|charging_station|bus_station|ferry_terminal|bicycle_rental|cinema|theatre|"
    "arts_centre|bank|atm|post_office|police|fire_station|townhall|library|school|college|university|kindergarten|"
    "place_of_worship|toilets|drinking_water|marketplace"
)
TOURISM = (
    "viewpoint|attraction|museum|gallery|artwork|information|zoo|aquarium|theme_park|hotel|hostel|guest_house|motel|"
    "apartment|chalet|camp_site|caravan_site|picnic_site"
)
LEISURE = "park|garden|nature_reserve|playground|swimming_pool|water_park|golf_course|stadium|sports_centre|dog_park|beach_resort"
HISTORIC = "castle|monument|memorial|ruins|archaeological_site|fort|manor|church|chapel"

_AMENITY_SET = set(AMENITY.split("|"))
# The family's representative class (the card's GPS_PLACE_OF knows it), by OSM key.
_SHOP_SUB = {
    "supermarket", "convenience", "greengrocer", "bakery", "pastry", "confectionery", "butcher", "clothes", "shoes",
    "books", "florist", "garden_centre", "hairdresser", "beauty", "bicycle", "wine", "alcohol", "mall",
    "department_store", "car_repair", "car_parts", "tyres", "car", "laundry", "dry_cleaning", "music",
}
_LODGING = {"hotel", "hostel", "guest_house", "motel", "apartment", "chalet"}
_CAMP = {"camp_site", "caravan_site"}
# Top of the list: what a traveller looks for first.
_RANK1 = {"viewpoint", "castle", "museum", "station", "airport", "aerodrome", "hospital", "theme_park", "zoo", "aquarium"}
_RANK4 = {"toilets", "drinking_water", "atm", "parking", "charging_station", "bicycle_rental"}
INFO_KEYS = (
    "opening_hours", "phone", "contact:phone", "website", "contact:website", "addr:housenumber", "addr:street",
    "addr:postcode", "addr:city", "brand", "cuisine", "wikipedia", "wikidata", "ele", "description",
)


def cells(bbox: tuple[float, float, float, float] = FRANCE_BBOX, step: float = CELL) -> list[tuple[float, float, float, float]]:
    """The squares (w, s, e, n) covering bbox, west to east, south to north."""
    w0, s0, e0, n0 = bbox
    out = []
    nx, ny = round((e0 - w0) / step), round((n0 - s0) / step)
    for j in range(ny):
        for i in range(nx):
            w, s = round(w0 + i * step, 6), round(s0 + j * step, 6)
            out.append((w, s, round(w + step, 6), round(s + step, 6)))
    return out


def cell_key(c: tuple[float, float, float, float]) -> str:
    return "%.4f,%.4f,%.4f,%.4f" % c


def split(c: tuple[float, float, float, float]) -> list[tuple[float, float, float, float]]:
    w, s, e, n = c
    mx, my = round((w + e) / 2, 6), round((s + n) / 2, 6)
    return [(w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)]


def query(c: tuple[float, float, float, float]) -> str:
    """Overpass QL: every kind Igor draws, inside the square, tags and centre only."""
    w, s, e, n = c
    b = f"({s},{w},{n},{e})"
    return (
        "[out:json][timeout:240][maxsize:1073741824];("
        f'nwr["amenity"~"^({AMENITY})$"]{b};'
        f'nwr["recycling_type"="centre"]{b};'
        f'nwr["shop"]{b};'
        f'nwr["tourism"~"^({TOURISM})$"]{b};'
        f'nwr["leisure"~"^({LEISURE})$"]{b};'
        f'nwr["historic"~"^({HISTORIC})$"]["name"]{b};'
        f'nwr["railway"~"^(station|halt|tram_stop)$"]{b};'
        f'node["highway"="bus_stop"]{b};'
        f'nwr["aeroway"="aerodrome"]["iata"]{b};'
        f'nwr["natural"="beach"]["name"]{b};'
        ");out tags center qt;"
    )


def classify(t: dict[str, str]) -> tuple[str, str] | None:
    """OSM tags → (class, subclass) as the card reads them (OpenMapTiles'
    words: the subclass is the tag's value, the class its family's word)."""
    a, sh, to, le, hi = t.get("amenity"), t.get("shop"), t.get("tourism"), t.get("leisure"), t.get("historic")
    if a == "fuel":
        return None
    if to == "viewpoint":
        return "attraction", "viewpoint"
    if to:
        if to == "information" and t.get("information") != "office":
            return None
        if to in _LODGING:
            return "lodging", to
        if to in _CAMP:
            return "campsite", "campsite"
        if to == "picnic_site":
            return "park", "picnic_site"
        if to == "gallery":
            return "art_gallery", "art_gallery"
        return "attraction", to
    if a and a in _AMENITY_SET:
        sub = {"townhall": "town_hall", "post_office": "post", "marketplace": "mall"}.get(a, a)
        return sub, sub
    if t.get("recycling_type") == "centre":
        return "recycling", "recycling"
    if sh:
        if sh in ("car", "car_repair", "car_parts", "tyres"):
            return "car", "car_repair" if sh != "car" else "car"
        if sh in ("alcohol", "wine"):
            return "alcohol_shop", "alcohol_shop"
        if sh in ("clothes", "shoes"):
            return "clothing_store", "clothes"
        if sh in ("supermarket", "convenience", "greengrocer"):
            return "grocery", sh
        if sh in ("bakery", "pastry", "confectionery"):
            return "bakery", sh
        return "shop", sh if sh in _SHOP_SUB else "shop"
    if le:
        sub = {"golf_course": "golf", "beach_resort": "beach"}.get(le, le)
        return "park" if sub in ("park", "garden", "nature_reserve", "dog_park") else sub, sub
    if hi:
        sub = {"fort": "castle", "manor": "castle", "church": "monument", "chapel": "monument"}.get(hi, hi)
        return "monument" if sub != "castle" else "castle", sub
    r = t.get("railway")
    if r in ("station", "halt"):
        return "railway", "subway" if t.get("station") == "subway" else "station"
    if r == "tram_stop":
        return "railway", "tram_stop"
    if t.get("highway") == "bus_stop":
        return "bus", "bus_stop"
    if t.get("aeroway") == "aerodrome":
        return "airport", "airport"
    if t.get("natural") == "beach":
        return "beach", "beach"
    return None


def rank(t: dict[str, str], sub: str) -> int:
    """1 (seen from far) … 5 (only close up)."""
    if sub == "bus_stop":
        return 5
    named, famous = bool(t.get("name")), bool(t.get("wikipedia") or t.get("wikidata"))
    if sub in _RANK1 and (named or sub == "viewpoint"):
        return 1
    if famous:
        return 2
    if named:
        return 3
    return 4 if sub in _RANK4 else 5


def parse(elements: list[dict]) -> list[tuple]:
    """Overpass' elements → rows (id, lon, lat, class, subclass, name, rank, info)."""
    rows, seen = [], set()
    for el in elements or []:
        if not isinstance(el, dict):
            continue
        t = el.get("tags") or {}
        cs = classify(t)
        if not cs:
            continue
        if "lat" in el and "lon" in el:
            lat, lon = el["lat"], el["lon"]
        else:
            c = el.get("center") or {}
            lat, lon = c.get("lat"), c.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            continue
        pid = {"node": "n", "way": "w", "relation": "r"}.get(el.get("type"), "x") + str(el.get("id"))
        if pid in seen:
            continue
        seen.add(pid)
        info = {k: str(t[k])[:200] for k in INFO_KEYS if t.get(k)}
        rows.append((pid, round(float(lon), 6), round(float(lat), 6), cs[0], cs[1], str(t.get("name") or "")[:80],
                     rank(t, cs[1]), json.dumps(info, ensure_ascii=False, separators=(",", ":")) if info else ""))
    return rows


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = math.radians
    a = math.sin(r(lat2 - lat1) / 2) ** 2 + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    return 6371000.0 * 2 * math.asin(math.sqrt(min(1.0, a)))


def tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z

    def lat(yy: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))

    return x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)


class PlacesDB:
    """The SQLite library (an R*Tree for the squares of the screen)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript(
                "PRAGMA journal_mode=WAL;"
                "CREATE TABLE IF NOT EXISTS places (rid INTEGER PRIMARY KEY, id TEXT UNIQUE, lon REAL, lat REAL, cls TEXT, sub TEXT, name TEXT, rank INTEGER, info TEXT, cell TEXT);"
                "CREATE VIRTUAL TABLE IF NOT EXISTS places_box USING rtree(rid, w, e, s, n);"
                "CREATE INDEX IF NOT EXISTS places_cell ON places(cell);"
                "CREATE TABLE IF NOT EXISTS cells (key TEXT PRIMARY KEY, state TEXT, count INTEGER, at REAL, tries INTEGER DEFAULT 0, err TEXT);"
            )

    def _db(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path, timeout=30)
        return db

    def seed(self, all_cells: list[tuple[float, float, float, float]]) -> None:
        with self._lock, self._db() as db:
            db.executemany("INSERT OR IGNORE INTO cells(key, state, count, at) VALUES (?, 'todo', 0, 0)", [(cell_key(c),) for c in all_cells])

    def next_cell(self, now: float) -> tuple[float, float, float, float] | None:
        """The next square to ask: never asked first (failed ones after a
        wait that grows), then the oldest past its month."""
        with self._lock, self._db() as db:
            row = db.execute(
                "SELECT key FROM cells WHERE state='todo' OR (state='error' AND at < ? - 600 * (1 << MIN(tries, 6))) ORDER BY state DESC, tries, key LIMIT 1",
                (now,),
            ).fetchone()
            if not row:
                row = db.execute("SELECT key FROM cells WHERE state='done' AND at < ? ORDER BY at LIMIT 1", (now - REFRESH_S,)).fetchone()
        return tuple(float(v) for v in row[0].split(",")) if row else None  # type: ignore[return-value]

    def store(self, c: tuple[float, float, float, float], rows: list[tuple], now: float) -> None:
        key = cell_key(c)
        with self._lock, self._db() as db:
            old = [r[0] for r in db.execute("SELECT rid FROM places WHERE cell=?", (key,))]
            if old:
                db.executemany("DELETE FROM places_box WHERE rid=?", [(r,) for r in old])
                db.execute("DELETE FROM places WHERE cell=?", (key,))
            w, s, e, n = c
            for r in rows:
                # A place sits in one square: the one its point falls in.
                if not (w <= r[1] < e and s <= r[2] < n):
                    continue
                cur = db.execute("INSERT OR REPLACE INTO places(id, lon, lat, cls, sub, name, rank, info, cell) VALUES (?,?,?,?,?,?,?,?,?)", (*r, key))
                db.execute("INSERT OR REPLACE INTO places_box(rid, w, e, s, n) VALUES (?,?,?,?,?)", (cur.lastrowid, r[1], r[1], r[2], r[2]))
            db.execute("INSERT OR REPLACE INTO cells(key, state, count, at, tries, err) VALUES (?, 'done', ?, ?, 0, NULL)", (key, len(rows), now))

    def failed(self, c: tuple[float, float, float, float], err: str, now: float) -> int:
        with self._lock, self._db() as db:
            key = cell_key(c)
            db.execute("UPDATE cells SET state='error', at=?, tries=tries+1, err=? WHERE key=?", (now, err[:200], key))
            row = db.execute("SELECT tries FROM cells WHERE key=?", (key,)).fetchone()
        return row[0] if row else 1

    def replace_cell(self, c: tuple[float, float, float, float], parts: list[tuple[float, float, float, float]]) -> None:
        """A square too full for one ask: its four quarters instead."""
        with self._lock, self._db() as db:
            db.execute("DELETE FROM cells WHERE key=?", (cell_key(c),))
            db.executemany("INSERT OR IGNORE INTO cells(key, state, count, at) VALUES (?, 'todo', 0, 0)", [(cell_key(p),) for p in parts])

    def places(self, b: tuple[float, float, float, float], max_rank: int = 5, limit: int = 4000) -> list[list]:
        w, s, e, n = b
        with self._db() as db:
            rows = db.execute(
                "SELECT p.id, p.lon, p.lat, p.cls, p.sub, p.name, p.rank FROM places_box x JOIN places p ON p.rid = x.rid "
                "WHERE x.w <= ? AND x.e >= ? AND x.s <= ? AND x.n >= ? AND p.rank <= ? ORDER BY p.rank LIMIT ?",
                (e, w, n, s, max_rank, limit),
            ).fetchall()
        return [list(r) for r in rows]

    def near(self, points: list[tuple[float, float]], radius_m: float, subs: list[str] | None = None, limit: int = 80) -> list[dict]:
        """The places within radius_m of any of the points (lat, lon), the
        nearest first, each with its sheet (hours, cuisine, phone…) — what
        Igor reads to choose. `subs`: only these subclasses (or classes)."""
        found: dict[str, dict] = {}
        with self._db() as db:
            for lat, lon in points[:12]:
                dlat = radius_m / 111320.0
                dlon = radius_m / (111320.0 * max(0.2, math.cos(math.radians(lat))))
                q = ("SELECT p.id, p.lon, p.lat, p.cls, p.sub, p.name, p.rank, p.info FROM places_box x JOIN places p ON p.rid = x.rid "
                     "WHERE x.w <= ? AND x.e >= ? AND x.s <= ? AND x.n >= ?")
                args: list[Any] = [lon + dlon, lon - dlon, lat + dlat, lat - dlat]
                if subs:
                    marks = ",".join("?" * len(subs))
                    q += f" AND (p.sub IN ({marks}) OR p.cls IN ({marks}))"
                    args += list(subs) + list(subs)
                q += " AND p.rank <= 4 LIMIT 4000"
                for r in db.execute(q, args):
                    d = _haversine(lat, lon, r[2], r[1])
                    if d > radius_m or (r[0] in found and found[r[0]]["d"] <= d):
                        continue
                    one = {"id": r[0], "lon": r[1], "lat": r[2], "class": r[3], "subclass": r[4], "name": r[5], "rank": r[6], "d": round(d)}
                    try:
                        one.update(json.loads(r[7]) if r[7] else {})
                    except ValueError:
                        pass
                    found[r[0]] = one
        out = sorted(found.values(), key=lambda x: (x["rank"] > 3, x["d"]))
        return out[:limit]

    def complete(self, b: tuple[float, float, float, float]) -> bool:
        """Every square under b already read (at least once)."""
        w, s, e, n = b
        with self._db() as db:
            for key, state in db.execute("SELECT key, state FROM cells"):
                cw, cs, ce, cn = (float(v) for v in key.split(","))
                if cw < e and ce > w and cs < n and cn > s and state != "done":
                    # A square tried and failed but with places from before stays good.
                    return False
        return True

    def info(self, pid: str) -> dict | None:
        with self._db() as db:
            r = db.execute("SELECT id, lon, lat, cls, sub, name, rank, info FROM places WHERE id=?", (pid,)).fetchone()
        if not r:
            return None
        out = {"id": r[0], "lon": r[1], "lat": r[2], "class": r[3], "subclass": r[4], "name": r[5], "rank": r[6]}
        try:
            out.update(json.loads(r[7]) if r[7] else {})
        except ValueError:
            pass
        return out

    def status(self) -> dict[str, Any]:
        with self._db() as db:
            by = dict(db.execute("SELECT state, COUNT(*) FROM cells GROUP BY state").fetchall())
            count = db.execute("SELECT COUNT(*) FROM places").fetchone()[0]
            err = db.execute("SELECT err FROM cells WHERE state='error' ORDER BY at DESC LIMIT 1").fetchone()
        total = sum(by.values()) or 1
        size = 0
        for p in (self.path, self.path.with_name(self.path.name + "-wal")):
            try:
                size += p.stat().st_size
            except OSError:
                pass
        return {"places": count, "cells_done": by.get("done", 0), "cells_total": total, "cells_error": by.get("error", 0),
                "progress": round(by.get("done", 0) / total, 4), "size_mb": round(size / 1048576, 1), "path": str(self.path),
                "last_error": err[0] if err else None}


def storage_path(config_path: Path) -> Path:
    """/share/igor when Home Assistant has it (left out of backups at will), else the config folder."""
    share = Path("/share")
    try:
        if share.is_dir():
            (share / "igor").mkdir(exist_ok=True)
            probe = share / "igor" / ".write"
            probe.write_text("ok")
            probe.unlink()
            return share / "igor" / "lieux.sqlite"
    except OSError:
        pass
    return config_path / "nives_offline" / "lieux.sqlite"


def now() -> float:
    return time.time()
