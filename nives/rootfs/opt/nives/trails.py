"""The marked hiking trails (GR, GRP, PR, local walks) as vector lines, for
Igor's map: OpenStreetMap's « route=hiking » relations, asked of Overpass
by zoom-10 square (about 40 × 26 km) the first time the map shows it, then
kept on Home Assistant (60 days) — the map draws them itself, in their
network's colours, and a touch on one opens its sheet.

Stored beside the places' library (sentiers.sqlite). Pure where it can be.
"""

from __future__ import annotations

import gzip
import json
import math
import sqlite3
import threading
from pathlib import Path
from typing import Any

KEEP_S = 60 * 86400
EMPTY_KEEP_S = 3 * 86400
INFO_KEYS = ("name", "ref", "network", "operator", "distance", "from", "to", "website", "wikipedia", "wikidata",
             "description", "osmc:symbol", "colour", "roundtrip", "ascent", "descent", "duration", "symbol", "note")
NETWORKS = {"iwn": "itinéraire international", "nwn": "GR · grande randonnée", "rwn": "GRP · grande randonnée de pays", "lwn": "PR · promenade et randonnée"}


def tile_bbox(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2 ** z

    def lat(yy: float) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))

    return x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)


def query(b: tuple[float, float, float, float]) -> str:
    w, s, e, n = b
    return f'[out:json][timeout:180];relation["route"="hiking"]({s},{w},{n},{e});out tags geom({s},{w},{n},{e});'


def _dist(a: list[float], b: list[float]) -> float:
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111320.0


def thin(line: list[list[float]], step: float = 12.0) -> list[list[float]]:
    """A point every `step` metres at most (the ends kept)."""
    if len(line) <= 2:
        return line
    out = [line[0]]
    for p in line[1:-1]:
        if _dist(out[-1], p) >= step:
            out.append(p)
    out.append(line[-1])
    return out


def parse(elements: list[dict]) -> list[dict]:
    """Overpass' relations → features {id, props, lines}."""
    feats = []
    for el in elements or []:
        if not isinstance(el, dict) or el.get("type") != "relation":
            continue
        t = el.get("tags") or {}
        lines = []
        for m in el.get("members") or []:
            if m.get("type") != "way" or not m.get("geometry"):
                continue
            pts = [[round(g["lon"], 6), round(g["lat"], 6)] for g in m["geometry"] if isinstance(g, dict) and "lat" in g and "lon" in g]
            pts = thin(pts)
            if len(pts) > 1:
                lines.append(pts)
        if not lines:
            continue
        feats.append({
            "id": "r" + str(el.get("id")),
            "props": {"name": str(t.get("name") or "")[:90], "ref": str(t.get("ref") or "")[:20], "net": str(t.get("network") or ""),
                      "colour": str(t.get("colour") or "")[:20]},
            "info": {k: str(t[k])[:400] for k in INFO_KEYS if t.get(k)},
            "lines": lines,
        })
    return feats


def length_km(lines: list[list[list[float]]]) -> float:
    return round(sum(_dist(a, b) for ln in lines for a, b in zip(ln, ln[1:])) / 1000.0, 1)


def geojson(feats: list[dict]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "MultiLineString", "coordinates": f["lines"]}, "properties": {"id": f["id"], **f["props"]}}
        for f in feats]}


class TrailsDB:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript(
                "PRAGMA journal_mode=WAL;"
                "CREATE TABLE IF NOT EXISTS tiles (key TEXT PRIMARY KEY, at REAL, n INTEGER, data BLOB);"
                "CREATE TABLE IF NOT EXISTS rels (id TEXT PRIMARY KEY, info TEXT, km REAL, at REAL);"
            )

    def _db(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=30)

    def get(self, key: str, now: float) -> dict | None:
        with self._db() as db:
            r = db.execute("SELECT at, n, data FROM tiles WHERE key=?", (key,)).fetchone()
        if not r or now - r[0] > (KEEP_S if r[1] else EMPTY_KEEP_S):
            return None
        return json.loads(gzip.decompress(r[2]))

    def stale(self, key: str) -> dict | None:
        """The copy kept, however old (Overpass silent: better than nothing)."""
        with self._db() as db:
            r = db.execute("SELECT data FROM tiles WHERE key=?", (key,)).fetchone()
        return json.loads(gzip.decompress(r[0])) if r else None

    def put(self, key: str, feats: list[dict], now: float) -> dict:
        gj = geojson(feats)
        with self.lock, self._db() as db:
            db.execute("INSERT OR REPLACE INTO tiles(key, at, n, data) VALUES (?, ?, ?, ?)",
                       (key, now, len(feats), sqlite3.Binary(gzip.compress(json.dumps(gj, separators=(",", ":")).encode()))))
            for f in feats:
                old = db.execute("SELECT km FROM rels WHERE id=?", (f["id"],)).fetchone()
                km = length_km(f["lines"])
                db.execute("INSERT OR REPLACE INTO rels(id, info, km, at) VALUES (?, ?, ?, ?)",
                           (f["id"], json.dumps(f["info"], ensure_ascii=False), max(km, old[0] if old else 0), now))
        return gj

    def info(self, rid: str) -> dict | None:
        with self._db() as db:
            r = db.execute("SELECT info, km FROM rels WHERE id=?", (rid,)).fetchone()
        if not r:
            return None
        out = json.loads(r[0]) if r[0] else {}
        out["id"] = rid
        out["km_seen"] = r[1]
        out["network_label"] = NETWORKS.get(out.get("network", ""), "")
        return out
