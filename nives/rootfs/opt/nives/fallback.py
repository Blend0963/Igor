"""Igor's spare map: metropolitan France and Corsica as vector tiles
(OpenStreetMap, Protomaps' basemap, zooms 0 to 14), kept on Home Assistant
and served by it, so the map still draws when TomTom does not answer (no
key, quota spent, outage) — in Igor's own colours.

Where from: Protomaps' public daily build of the whole planet (one PMTiles
file, read by ranges — the way its own « pmtiles extract » works): its
directories first, then only France's tiles, the bytes next to each other
asked together. The planet itself is never downloaded. Done in the
background, a piece of France (a zoom-8 square and all beneath it) at a
time, resumed where it stopped after a restart; renewed every 90 days.

Where to: one SQLite file beside the places' library (/share/igor/carte.sqlite,
else <config>/nives_offline/), the tiles kept as Protomaps compressed them,
identical ones (the sea, the fields) stored once. A few fonts for the names
(Noto Sans, Latin ranges) beside it.

Pure where it can be: the Hilbert ids, the header and directory formats, the
pieces and the byte ranges are tested without network.
"""

from __future__ import annotations

import gzip
import math
import sqlite3
import struct
import threading
from pathlib import Path
from typing import Any

FRANCE_BBOX = (-5.25, 41.25, 9.75, 51.25)
MAX_ZOOM = 14
PIECE_Z = 8
BUILDS_URL = "https://build-metadata.protomaps.dev/builds.json"
BUILD_URL = "https://build.protomaps.com/{key}"
FONTS_URL = "https://protomaps.github.io/basemaps-assets/fonts/{font}/{range}.pbf"
FONTS = ("Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic")
FONT_RANGES = ("0-255", "256-511", "512-767", "768-1023", "7936-8191", "8192-8447", "8448-8703")
REFRESH_DAYS = 90


# ----- PMTiles v3: ids, header, directories -----
def _rotate(n: int, x: int, y: int, rx: int, ry: int) -> tuple[int, int]:
    if ry == 0:
        if rx == 1:
            x, y = n - 1 - x, n - 1 - y
        x, y = y, x
    return x, y


def hilbert(z: int, x: int, y: int) -> int:
    """The tile's position along the Hilbert curve of its zoom."""
    n, d, s = 1 << z, 0, (1 << z) >> 1
    while s > 0:
        rx = 1 if x & s else 0
        ry = 1 if y & s else 0
        d += s * s * ((3 * rx) ^ ry)
        x, y = _rotate(s, x, y, rx, ry)
        s >>= 1
    return d


def zoom_base(z: int) -> int:
    return ((1 << (2 * z)) - 1) // 3


def tile_id(z: int, x: int, y: int) -> int:
    return zoom_base(z) + hilbert(z, x, y)


def lonlat_tile(z: int, lon: float, lat: float) -> tuple[int, int]:
    n = 1 << z
    lat = max(-85.0511, min(85.0511, lat))
    x = int((lon + 180.0) / 360.0 * n)
    r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tiles_in(z: int, bbox: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    w, s, e, n = bbox
    x0, y0 = lonlat_tile(z, w, n)
    x1, y1 = lonlat_tile(z, e, s)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


def pieces(bbox: tuple[float, float, float, float] = FRANCE_BBOX) -> list[str]:
    """The work, cut in pieces: « low » (zooms 0-7), then each zoom-8 square."""
    return ["low"] + ["%d/%d/%d" % (PIECE_Z, x, y) for x, y in tiles_in(PIECE_Z, bbox)]


def piece_ranges(piece: str, bbox: tuple[float, float, float, float] = FRANCE_BBOX, max_zoom: int = MAX_ZOOM) -> list[tuple[int, int]]:
    """The tile ids a piece holds, as [first, last] ranges: the zoom-8
    square's descendants are one run of the Hilbert curve at each zoom."""
    if piece == "low":
        out = []
        for z in range(0, PIECE_Z):
            for x, y in tiles_in(z, bbox):
                t = tile_id(z, x, y)
                out.append((t, t))
        return sorted(out)
    z8, x8, y8 = (int(v) for v in piece.split("/"))
    d8, out = hilbert(z8, x8, y8), []
    for z in range(z8, max_zoom + 1):
        k = 4 ** (z - z8)
        a = zoom_base(z) + d8 * k
        out.append((a, a + k - 1))
    return out


def read_header(b: bytes) -> dict[str, Any]:
    if len(b) < 127 or b[:7] != b"PMTiles" or b[7] != 3:
        raise ValueError("pas un PMTiles v3")
    f = struct.unpack_from("<11Q", b, 8)
    keys = ("root_offset", "root_length", "metadata_offset", "metadata_length", "leaf_offset", "leaf_length",
            "data_offset", "data_length", "addressed", "entries", "contents")
    h = dict(zip(keys, f))
    h["clustered"], h["internal_compression"], h["tile_compression"], h["tile_type"], h["min_zoom"], h["max_zoom"] = struct.unpack_from("<6B", b, 96)
    return h


def _varint(b: bytes, i: int) -> tuple[int, int]:
    shift = val = 0
    while True:
        c = b[i]
        i += 1
        val |= (c & 0x7F) << shift
        if c < 0x80:
            return val, i
        shift += 7


def _uncompress(b: bytes, comp: int) -> bytes:
    return gzip.decompress(b) if comp == 2 else b


def read_directory(b: bytes, comp: int = 2) -> list[tuple[int, int, int, int]]:
    """(tile_id, offset, length, run_length); run_length 0: a leaf directory."""
    b = _uncompress(b, comp)
    n, i = _varint(b, 0)
    ids, runs, lens, offs = [0] * n, [0] * n, [0] * n, [0] * n
    last = 0
    for k in range(n):
        v, i = _varint(b, i)
        last += v
        ids[k] = last
    for k in range(n):
        runs[k], i = _varint(b, i)
    for k in range(n):
        lens[k], i = _varint(b, i)
    for k in range(n):
        v, i = _varint(b, i)
        offs[k] = offs[k - 1] + lens[k - 1] if v == 0 and k > 0 else v - 1
    return list(zip(ids, offs, lens, runs))


def write_directory(entries: list[tuple[int, int, int, int]]) -> bytes:
    """The reverse (tests; uncompressed)."""
    out = bytearray()

    def put(v: int) -> None:
        while v >= 0x80:
            out.append((v & 0x7F) | 0x80)
            v >>= 7
        out.append(v)

    put(len(entries))
    last = 0
    for e in entries:
        put(e[0] - last)
        last = e[0]
    for e in entries:
        put(e[3])
    for e in entries:
        put(e[2])
    for k, e in enumerate(entries):
        put(0 if k > 0 and e[1] == entries[k - 1][1] + entries[k - 1][2] else e[1] + 1)
    return bytes(out)


def overlaps(entry_first: int, entry_last: int, ranges: list[tuple[int, int]]) -> bool:
    return any(a <= entry_last and entry_first <= b for a, b in ranges)


def leaves_for(directory: list[tuple[int, int, int, int]], ranges: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """The leaf directories (offset, length) whose ids meet the ranges."""
    out = []
    for k, (tid, off, ln, run) in enumerate(directory):
        if run != 0:
            continue
        last = directory[k + 1][0] - 1 if k + 1 < len(directory) else 1 << 62
        if overlaps(tid, last, ranges):
            out.append((off, ln))
    return out


def tiles_for(directory: list[tuple[int, int, int, int]], ranges: list[tuple[int, int]]) -> list[tuple[int, int, int, int]]:
    return [e for e in directory if e[3] > 0 and overlaps(e[0], e[0] + e[3] - 1, ranges)]


def byte_spans(entries: list[tuple[int, int, int, int]], gap: int = 262144, most: int = 16 << 20) -> list[tuple[int, int]]:
    """The tiles' bytes as few requests as possible: neighbours (less than
    `gap` apart) asked together, `most` bytes at most per request."""
    spans: list[list[int]] = []
    for off, ln in sorted({(e[1], e[2]) for e in entries}):
        if spans and off - spans[-1][1] <= gap and off + ln - spans[-1][0] <= most:
            spans[-1][1] = max(spans[-1][1], off + ln)
        else:
            spans.append([off, off + ln])
    return [(a, b) for a, b in spans]


class SpareMap:
    """The SQLite store: entries (tile id, run, blob) and the blobs."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._db() as db:
            db.executescript(
                "PRAGMA journal_mode=WAL;"
                "CREATE TABLE IF NOT EXISTS entries (tid INTEGER PRIMARY KEY, run INTEGER, blob INTEGER);"
                "CREATE TABLE IF NOT EXISTS blobs (id INTEGER PRIMARY KEY, data BLOB, key TEXT UNIQUE);"
                "CREATE TABLE IF NOT EXISTS pieces (key TEXT PRIMARY KEY, state TEXT, build TEXT, tries INTEGER DEFAULT 0, at REAL DEFAULT 0, err TEXT);"
                "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);"
                "CREATE TABLE IF NOT EXISTS fonts (name TEXT PRIMARY KEY, data BLOB);"
            )

    def _db(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=30)

    def meta(self, k: str, v: str | None = None) -> str | None:
        with self._lock, self._db() as db:
            if v is not None:
                db.execute("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)", (k, v))
                return v
            r = db.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
        return r[0] if r else None

    def seed(self, keys: list[str], build: str) -> None:
        """A new build: every piece to do again (the old tiles serve meanwhile)."""
        with self._lock, self._db() as db:
            db.executemany("INSERT OR IGNORE INTO pieces(key, state, build) VALUES (?, 'todo', '')", [(k,) for k in keys])
            db.execute("UPDATE pieces SET state='todo', tries=0 WHERE build != ?", (build,))

    def next_piece(self, now: float) -> str | None:
        with self._lock, self._db() as db:
            r = db.execute("SELECT key FROM pieces WHERE state='todo' OR (state='error' AND at < ? - 300 * (1 << MIN(tries, 6))) ORDER BY state DESC, tries, key LIMIT 1", (now,)).fetchone()
        return r[0] if r else None

    def store(self, key: str, build: str, entries: list[tuple[int, int, int, int]], data: dict[tuple[int, int], bytes], done: bool = True) -> None:
        """Tiles in (replacing the same ids), identical bytes once across the
        whole build (the sea, the fields: one blob). `done`: the piece is
        complete (a piece is stored in several goes, its bytes as they come)."""
        with self._lock, self._db() as db:
            for tid, off, ln, run in entries:
                b = data.get((off, ln))
                if b is None:
                    continue
                bkey = f"{build}:{off}:{ln}"
                row = db.execute("SELECT id FROM blobs WHERE key=?", (bkey,)).fetchone()
                bid = row[0] if row else db.execute("INSERT INTO blobs(data, key) VALUES (?, ?)", (sqlite3.Binary(b), bkey)).lastrowid
                old = db.execute("SELECT blob FROM entries WHERE tid=?", (tid,)).fetchone()
                db.execute("INSERT OR REPLACE INTO entries(tid, run, blob) VALUES (?, ?, ?)", (tid, run, bid))
                if old and old[0] != bid and not db.execute("SELECT 1 FROM entries WHERE blob=? LIMIT 1", (old[0],)).fetchone():
                    db.execute("DELETE FROM blobs WHERE id=?", (old[0],))
            if done:
                db.execute("UPDATE pieces SET state='done', build=?, tries=0, err=NULL WHERE key=?", (build, key))

    def failed(self, key: str, err: str, now: float) -> None:
        with self._lock, self._db() as db:
            db.execute("UPDATE pieces SET state='error', at=?, tries=tries+1, err=? WHERE key=?", (now, err[:200], key))

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        t = tile_id(z, x, y)
        with self._db() as db:
            r = db.execute("SELECT e.tid, e.run, b.data FROM entries e JOIN blobs b ON b.id = e.blob WHERE e.tid <= ? ORDER BY e.tid DESC LIMIT 1", (t,)).fetchone()
        if r and t < r[0] + r[1]:
            return bytes(r[2])
        return None

    def font(self, name: str, data: bytes | None = None) -> bytes | None:
        with self._lock, self._db() as db:
            if data is not None:
                db.execute("INSERT OR REPLACE INTO fonts(name, data) VALUES (?, ?)", (name, sqlite3.Binary(data)))
                return data
            r = db.execute("SELECT data FROM fonts WHERE name=?", (name,)).fetchone()
        return bytes(r[0]) if r else None

    def status(self) -> dict[str, Any]:
        with self._db() as db:
            by = dict(db.execute("SELECT state, COUNT(*) FROM pieces GROUP BY state").fetchall())
            tiles = db.execute("SELECT COUNT(*) FROM entries").fetchone()[0]
            err = db.execute("SELECT err FROM pieces WHERE state='error' ORDER BY at DESC LIMIT 1").fetchone()
        total = sum(by.values()) or 1
        size = 0
        for p in (self.path, self.path.with_name(self.path.name + "-wal")):
            try:
                size += p.stat().st_size
            except OSError:
                pass
        return {"tiles": tiles, "pieces_done": by.get("done", 0), "pieces_total": total, "progress": round(by.get("done", 0) / total, 4),
                "ready": by.get("done", 0) == total and tiles > 0, "usable": tiles > 0, "size_mb": round(size / 1048576, 1),
                "build": self.meta("build"), "compression": self.meta("compression"), "path": str(self.path), "last_error": err[0] if err else None}


# ----- the map's look: Protomaps' layers in Igor's colours -----
PAL = {
    "nuit": {"bg": "#1a1c38", "water": "#2a2f66", "park": "#1e5049", "wood": "#1b4743", "urban": "#212548", "bld": "#2e3568",
             "major": "#8c90c2", "minor": "#5a5f92", "path": "#474c80", "case": "#13152b", "rail": "#4b5088", "label": "#e2e4ff", "halo": "#11122a", "border": "#6a6fb0"},
    "jour": {"bg": "#d3e2c6", "water": "#3fb5d9", "park": "#7fbf73", "wood": "#86be78", "urban": "#d4d8e4", "bld": "#c6cee2",
             "major": "#f4f1e6", "minor": "#ffffff", "path": "#e9e4d6", "case": "#aab3c4", "rail": "#9aa3b5", "label": "#26303b", "halo": "#ffffff", "border": "#8e7fb0"},
}


def style(tiles_url: str, glyphs_url: str, theme: str = "nuit") -> dict[str, Any]:
    c = PAL.get(theme, PAL["nuit"])
    w = lambda a, b, d: ["interpolate", ["exponential", 1.6], ["zoom"], a, b, 18, d]  # noqa: E731
    road = lambda kinds: ["in", ["get", "kind"], ["literal", kinds]]  # noqa: E731
    name = ["coalesce", ["get", "name:fr"], ["get", "name"]]
    src = "spare"
    return {
        "version": 8, "name": "Igor · carte de secours",
        "glyphs": glyphs_url,
        "sources": {src: {"type": "vector", "tiles": [tiles_url], "minzoom": 0, "maxzoom": MAX_ZOOM,
                          "attribution": "© OpenStreetMap · Protomaps"}},
        "layers": [
            {"id": "bg", "type": "background", "paint": {"background-color": c["bg"]}},
            {"id": "earth", "type": "fill", "source": src, "source-layer": "earth", "paint": {"fill-color": c["bg"]}},
            {"id": "urban", "type": "fill", "source": src, "source-layer": "landuse",
             "filter": road(["residential", "commercial", "industrial", "retail", "urban_area", "neighbourhood"]), "paint": {"fill-color": c["urban"]}},
            {"id": "wood", "type": "fill", "source": src, "source-layer": "landcover", "filter": road(["forest", "wood", "scrub", "grassland"]), "paint": {"fill-color": c["wood"], "fill-opacity": 0.8}},
            {"id": "park", "type": "fill", "source": src, "source-layer": "landuse",
             "filter": road(["park", "forest", "wood", "nature_reserve", "national_park", "grass", "meadow", "garden", "golf_course", "cemetery", "playground", "pitch"]),
             "paint": {"fill-color": c["park"]}},
            {"id": "water", "type": "fill", "source": src, "source-layer": "water", "paint": {"fill-color": c["water"]}},
            {"id": "rivers", "type": "line", "source": src, "source-layer": "water", "filter": ["==", ["geometry-type"], "LineString"],
             "paint": {"line-color": c["water"], "line-width": w(9, 0.6, 6)}},
            {"id": "boundaries", "type": "line", "source": src, "source-layer": "boundaries", "filter": ["<=", ["coalesce", ["get", "kind_detail"], 2], 4],
             "paint": {"line-color": c["border"], "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.6}},
            {"id": "buildings", "type": "fill", "source": src, "source-layer": "buildings", "minzoom": 14, "paint": {"fill-color": c["bld"], "fill-opacity": 0.9}},
            {"id": "paths", "type": "line", "source": src, "source-layer": "roads", "minzoom": 13, "filter": road(["path", "other"]),
             "paint": {"line-color": c["path"], "line-width": w(13, 0.5, 3), "line-dasharray": [2, 1]}},
            {"id": "rail", "type": "line", "source": src, "source-layer": "roads", "filter": road(["rail"]), "paint": {"line-color": c["rail"], "line-width": w(10, 0.6, 3)}},
            {"id": "minor-case", "type": "line", "source": src, "source-layer": "roads", "minzoom": 12, "filter": road(["minor_road"]),
             "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["case"], "line-width": w(12, 1.5, 22)}},
            {"id": "minor", "type": "line", "source": src, "source-layer": "roads", "minzoom": 12, "filter": road(["minor_road"]),
             "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["minor"], "line-width": w(12, 0.8, 18)}},
            {"id": "major-case", "type": "line", "source": src, "source-layer": "roads", "filter": road(["major_road", "highway"]),
             "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["case"], "line-width": w(6, 1, 30)}},
            {"id": "major", "type": "line", "source": src, "source-layer": "roads", "filter": road(["major_road", "highway"]),
             "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["major"], "line-width": w(6, 0.5, 25)}},
            {"id": "road-names", "type": "symbol", "source": src, "source-layer": "roads", "minzoom": 14, "filter": road(["major_road", "minor_road", "highway"]),
             "layout": {"symbol-placement": "line", "text-field": name, "text-font": ["Noto Sans Regular"], "text-size": 12},
             "paint": {"text-color": c["label"], "text-halo-color": c["halo"], "text-halo-width": 1.5}},
            {"id": "places", "type": "symbol", "source": src, "source-layer": "places",
             "filter": road(["locality", "neighbourhood", "macrohood", "region", "country"]),
             "layout": {"text-field": name, "text-font": ["Noto Sans Medium"], "text-size": ["interpolate", ["linear"], ["zoom"], 5, 11, 12, 15, 16, 17],
                        "symbol-sort-key": ["coalesce", ["get", "min_zoom"], 10]},
             "paint": {"text-color": c["label"], "text-halo-color": c["halo"], "text-halo-width": 1.8}},
        ],
    }
