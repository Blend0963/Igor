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
MAX_ZOOM = 15
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

    def deepen(self, max_zoom: int) -> bool:
        """The map kept down to a shallower zoom: every piece asked again
        (the tiles already there stay and serve meanwhile). True if so."""
        with self._lock, self._db() as db:
            r = db.execute("SELECT v FROM meta WHERE k='max_zoom'").fetchone()
            if r and r[0] == str(max_zoom):
                return False
            db.execute("UPDATE pieces SET state='todo', tries=0")
            db.execute("INSERT OR REPLACE INTO meta(k, v) VALUES ('max_zoom', ?)", (str(max_zoom),))
        return True

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
# One name per kind of thing, each in its own face: the regions in thin wide
# capitals, the towns in bold narrow capitals, the districts in small spaced
# capitals, the water in blue italics, the woods in green italics; no street
# names (a touch on a street says it), only the road numbers in their panels.
PAL = {
    "nuit": {"bg": "#1f3a3d", "earth": "#1f3a3d", "water": "#2a2f66", "water2": "#23285a", "park": "#1e5049", "grass": "#24453f", "wood": "#1b4743",
             "field": "#33402c", "sand": "#6d5f3e", "urban": "#212548", "bld": "#36407a", "bld2": "#2a3366", "hw": "#b49b46", "hwcase": "#6f5e25",
             "hwfar": "#8c90c2", "major": "#8c90c2", "minor": "#5a5f92", "path": "#474c80", "case": "#13152b", "rail": "#4b5088",
             "city": "#e2e4ff", "cityhalo": "#11122a", "region": "rgba(226,228,255,0.55)", "quarter": "#9a9dd0", "wlabel": "#7fb6ff",
             "glabel": "#7fcf9a", "halo": "#11122a", "border": "#6a6fb0"},
    "jour": {"bg": "#a9c6a2", "earth": "#a9c6a2", "water": "#3fb2d6", "water2": "#2f9cc4", "park": "#7fbf73", "grass": "#b6d3a5", "wood": "#5f9a64",
             "field": "#a8a768", "sand": "#e6cf96", "urban": "#d3d6e2", "bld": "#b2c2df", "bld2": "#7f96c3", "hw": "#f7df7c", "hwcase": "#d6b54a",
             "hwfar": "#ffffff", "major": "#ffffff", "minor": "#ffffff", "path": "#e9e4d6", "case": "#b8bfcc", "rail": "#9aa3b5",
             "city": "#ffffff", "cityhalo": "#33415c", "region": "rgba(255,255,255,0.85)", "quarter": "#5a6378", "wlabel": "#1d6f9a",
             "glabel": "#2f5d33", "halo": "rgba(255,255,255,0.85)", "border": "#8e7fb0"},
}


# The faces Igor ships (frontend/fonts, OFL), Latin then Latin Extended.
LATIN = ["U+0000-00FF", "U+0131", "U+0152-0153", "U+02BB-02BC", "U+02C6", "U+02DA", "U+02DC", "U+0304", "U+0308", "U+0329",
         "U+2000-206F", "U+20AC", "U+2122", "U+2191", "U+2193", "U+2212", "U+2215", "U+FEFF", "U+FFFD"]
LATIN_EXT = ["U+0100-02BA", "U+02BD-02C5", "U+02C7-02CC", "U+02CE-02D7", "U+02DD-02FF", "U+1D00-1DBF", "U+1E00-1E9F",
             "U+1EF2-1EFF", "U+2020", "U+20A0-20AB", "U+20AD-20C0", "U+2113", "U+2C60-2C7F", "U+A720-A7FF"]
FACES = {
    "Igor Rubik Light": "rubik-{r}-300-normal", "Igor Rubik": "rubik-{r}-400-normal", "Igor Rubik Medium": "rubik-{r}-500-normal",
    "Igor Rubik SemiBold": "rubik-{r}-600-normal", "Igor Rubik Italic": "rubik-{r}-400-italic", "Igor Rubik Medium Italic": "rubik-{r}-500-italic",
    "Igor Barlow Bold": "barlow-condensed-{r}-700-normal", "Igor Barlow SemiBold": "barlow-condensed-{r}-600-normal",
}


def igor_faces(base: str) -> dict[str, list[dict[str, Any]]]:
    """MapLibre's « font-faces »: each face name → its Latin files."""
    return {name: [{"url": f"{base}/{pat.format(r='latin')}.woff2", "unicode-range": LATIN},
                   {"url": f"{base}/{pat.format(r='latin-ext')}.woff2", "unicode-range": LATIN_EXT}] for name, pat in FACES.items()}


rubik_faces = igor_faces


def style(tiles_url: str, glyphs_url: str, theme: str = "nuit", buildings_3d: bool = True, opacity: float = 0.9,
          fonts_url: str | None = None) -> dict[str, Any]:
    c = PAL.get(theme, PAL["nuit"])
    w = lambda a, b, d: ["interpolate", ["exponential", 1.6], ["zoom"], a, b, 18, d]  # noqa: E731
    kind = lambda kinds: ["in", ["get", "kind"], ["literal", kinds]]  # noqa: E731
    name = ["coalesce", ["get", "name:fr"], ["get", "name"]]
    f = (lambda igor, noto: [igor]) if fonts_url else (lambda igor, noto: [noto])  # noqa: E731
    src = "spare"
    ref = ["coalesce", ["get", "shield_text"], ["get", "ref"], ""]
    first = ["slice", ["to-string", ref], 0, 1]
    layers: list[dict[str, Any]] = [
        {"id": "bg", "type": "background", "paint": {"background-color": c["bg"]}},
        {"id": "earth", "type": "fill", "source": src, "source-layer": "earth", "paint": {"fill-color": c["earth"]}},
        # The ground: fields olive, meadows light, woods deep, built-up lavender, sand.
        {"id": "lc-field", "type": "fill", "source": src, "source-layer": "landcover", "filter": kind(["farmland"]), "paint": {"fill-color": c["field"], "fill-opacity": 0.75}},
        {"id": "lc-grass", "type": "fill", "source": src, "source-layer": "landcover", "filter": kind(["grassland", "scrub", "barren"]), "paint": {"fill-color": c["grass"]}},
        {"id": "lc-wood", "type": "fill", "source": src, "source-layer": "landcover", "filter": kind(["forest"]), "paint": {"fill-color": c["wood"]}},
        {"id": "lc-urban", "type": "fill", "source": src, "source-layer": "landcover", "filter": kind(["urban_area"]), "paint": {"fill-color": c["urban"]}},
        {"id": "lu-urban", "type": "fill", "source": src, "source-layer": "landuse",
         "filter": kind(["residential", "commercial", "industrial", "retail", "railway", "school", "university", "hospital", "pedestrian", "parking", "military"]),
         "paint": {"fill-color": c["urban"]}},
        {"id": "lu-field", "type": "fill", "source": src, "source-layer": "landuse", "filter": kind(["farmland", "orchard", "vineyard", "allotments"]), "paint": {"fill-color": c["field"], "fill-opacity": 0.8}},
        {"id": "lu-grass", "type": "fill", "source": src, "source-layer": "landuse", "filter": kind(["grass", "meadow", "village_green", "recreation_ground", "golf_course", "cemetery", "playground", "pitch"]),
         "paint": {"fill-color": c["grass"]}},
        {"id": "lu-park", "type": "fill", "source": src, "source-layer": "landuse", "filter": kind(["park", "garden", "nature_reserve", "national_park", "protected_area", "zoo"]), "paint": {"fill-color": c["park"]}},
        {"id": "lu-wood", "type": "fill", "source": src, "source-layer": "landuse", "filter": kind(["forest", "wood"]), "paint": {"fill-color": c["wood"]}},
        {"id": "lu-sand", "type": "fill", "source": src, "source-layer": "landuse", "filter": kind(["beach", "sand", "dune"]), "paint": {"fill-color": c["sand"]}},
        {"id": "water", "type": "fill", "source": src, "source-layer": "water", "filter": ["!=", ["geometry-type"], "LineString"],
         "paint": {"fill-color": ["match", ["get", "kind"], "ocean", c["water2"], c["water"]]}},
        {"id": "rivers", "type": "line", "source": src, "source-layer": "water", "filter": ["==", ["geometry-type"], "LineString"],
         "layout": {"line-cap": "round"}, "paint": {"line-color": c["water"], "line-width": w(9, 0.6, 7)}},
        {"id": "boundaries", "type": "line", "source": src, "source-layer": "boundaries", "filter": ["<=", ["coalesce", ["get", "kind_detail"], 2], 4],
         "paint": {"line-color": c["border"], "line-width": 1, "line-dasharray": [3, 2], "line-opacity": 0.5}},
        {"id": "paths", "type": "line", "source": src, "source-layer": "roads", "minzoom": 14, "filter": kind(["path", "other"]),
         "paint": {"line-color": c["path"], "line-width": w(14, 0.6, 3), "line-dasharray": [2, 1]}},
        {"id": "rail", "type": "line", "source": src, "source-layer": "roads", "filter": kind(["rail"]), "paint": {"line-color": c["rail"], "line-width": w(10, 0.6, 3)}},
        {"id": "minor-case", "type": "line", "source": src, "source-layer": "roads", "minzoom": 12, "filter": kind(["minor_road"]),
         "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["case"], "line-width": w(12, 1.5, 22)}},
        {"id": "minor", "type": "line", "source": src, "source-layer": "roads", "minzoom": 12, "filter": kind(["minor_road"]),
         "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["minor"], "line-width": w(12, 0.8, 18)}},
        {"id": "major-case", "type": "line", "source": src, "source-layer": "roads", "filter": kind(["major_road"]),
         "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["case"], "line-width": w(6, 1, 30)}},
        {"id": "major", "type": "line", "source": src, "source-layer": "roads", "filter": kind(["major_road"]),
         "layout": {"line-cap": "round", "line-join": "round"}, "paint": {"line-color": c["major"], "line-width": w(6, 0.5, 25)}},
        # The motorways: white from far, yellow close up, a deeper edge.
        {"id": "highway-case", "type": "line", "source": src, "source-layer": "roads", "filter": kind(["highway"]),
         "layout": {"line-cap": "round", "line-join": "round"},
         "paint": {"line-color": ["step", ["zoom"], c["case"], 11, c["hwcase"]], "line-width": w(5, 1.4, 34)}},
        {"id": "highway", "type": "line", "source": src, "source-layer": "roads", "filter": kind(["highway"]),
         "layout": {"line-cap": "round", "line-join": "round"},
         "paint": {"line-color": ["step", ["zoom"], c["hwfar"], 11, c["hw"]], "line-width": w(5, 0.9, 28)}},
    ]
    layers.append(
        {"id": "buildings", "type": "fill-extrusion", "source": src, "source-layer": "buildings", "minzoom": 13,
         "paint": {"fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "height"], 9], 4, c["bld"], 40, c["bld2"]],
                   "fill-extrusion-opacity": max(0.3, min(1.0, opacity)), "fill-extrusion-vertical-gradient": True,
                   "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 15,
                                             ["coalesce", ["get", "height"], ["*", ["coalesce", ["get", "building:levels"], 0], 3], 9]],
                   "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 13, 0, 15, ["coalesce", ["get", "min_height"], 0]]}}
        if buildings_3d else
        {"id": "buildings", "type": "fill", "source": src, "source-layer": "buildings", "minzoom": 13, "paint": {"fill-color": c["bld"], "fill-opacity": 0.9}})
    halo = lambda col, wd=1.4: {"text-halo-color": col, "text-halo-width": wd}  # noqa: E731
    layers += [
        # The road numbers in their panels: A red, N red, D yellow (images drawn by the card).
        {"id": "shields", "type": "symbol", "source": src, "source-layer": "roads", "minzoom": 9,
         "filter": ["all", ["!=", ref, ""], ["in", ["get", "kind"], ["literal", ["highway", "major_road"]]]],
         "layout": {"symbol-placement": "line", "symbol-spacing": 420, "text-field": ref, "text-font": f("Igor Barlow SemiBold", "Noto Sans Medium"), "text-size": 12,
                    "text-rotation-alignment": "viewport", "icon-rotation-alignment": "viewport",
                    "icon-image": ["match", first, ["A", "N", "E"], "igl-shield-red", "D", "igl-shield-yellow", "igl-shield-white"],
                    "icon-text-fit": "both", "icon-text-fit-padding": [2, 5, 1, 5]},
         "paint": {"text-color": ["match", first, ["A", "N", "E"], "#ffffff", "#2a2400"]}},
        {"id": "water-names", "type": "symbol", "source": src, "source-layer": "water", "filter": ["all", ["has", "name"], ["==", ["geometry-type"], "Point"]],
         "layout": {"text-field": name, "text-font": f("Igor Rubik Italic", "Noto Sans Italic"), "text-size": ["interpolate", ["linear"], ["zoom"], 6, 12, 14, 15],
                    "text-letter-spacing": 0.08, "text-max-width": 8},
         "paint": {"text-color": c["wlabel"], **halo(c["halo"], 1)}},
        {"id": "river-names", "type": "symbol", "source": src, "source-layer": "water", "minzoom": 11, "filter": ["all", ["has", "name"], ["==", ["geometry-type"], "LineString"]],
         "layout": {"symbol-placement": "line", "text-field": name, "text-font": f("Igor Rubik Italic", "Noto Sans Italic"), "text-size": 13, "text-letter-spacing": 0.1},
         "paint": {"text-color": c["wlabel"], **halo(c["halo"], 1)}},
        {"id": "green-names", "type": "symbol", "source": src, "source-layer": "landuse", "minzoom": 12,
         "filter": ["all", ["has", "name"], kind(["park", "forest", "wood", "nature_reserve", "national_park", "garden"])],
         "layout": {"text-field": name, "text-font": f("Igor Rubik Italic", "Noto Sans Italic"), "text-size": 12.5, "text-max-width": 8},
         "paint": {"text-color": c["glabel"], **halo(c["halo"], 1)}},
        {"id": "quarters", "type": "symbol", "source": src, "source-layer": "places", "minzoom": 13,
         "filter": ["any", kind(["neighbourhood", "macrohood"]), ["all", kind(["locality"]), ["!", ["in", ["get", "kind_detail"], ["literal", ["city", "town", "village"]]]]]],
         "layout": {"text-field": ["upcase", name], "text-font": f("Igor Rubik Medium", "Noto Sans Medium"), "text-size": 11.5, "text-letter-spacing": 0.3, "text-max-width": 9},
         "paint": {"text-color": c["quarter"], **halo(c["halo"], 1)}},
        {"id": "towns", "type": "symbol", "source": src, "source-layer": "places",
         "filter": ["all", kind(["locality"]), ["in", ["get", "kind_detail"], ["literal", ["city", "town", "village"]]]],
         "layout": {"text-field": ["upcase", name], "text-font": f("Igor Barlow Bold", "Noto Sans Medium"), "text-letter-spacing": 0.04,
                    "text-size": ["interpolate", ["linear"], ["zoom"], 6, ["match", ["get", "kind_detail"], "city", 15, 11], 12, ["match", ["get", "kind_detail"], "city", 24, 17], 15, 19],
                    "symbol-sort-key": ["coalesce", ["get", "min_zoom"], 10], "text-max-width": 10},
         "paint": {"text-color": c["city"], **halo(c["cityhalo"], 1.6)}},
        {"id": "regions", "type": "symbol", "source": src, "source-layer": "places", "maxzoom": 10, "filter": kind(["region", "country"]),
         "layout": {"text-field": ["upcase", name], "text-font": f("Igor Rubik Light", "Noto Sans Regular"), "text-letter-spacing": 0.45,
                    "text-size": ["interpolate", ["linear"], ["zoom"], 4, 14, 9, 26], "text-max-width": 14},
         "paint": {"text-color": c["region"]}},
    ]
    out: dict[str, Any] = {
        "version": 8, "name": "Igor",
        "light": {"anchor": "viewport", "color": "#ffffff" if theme == "jour" else "#b9bdf0", "intensity": 0.35 if theme == "jour" else 0.28, "position": [1.15, 210, 30]},
        "glyphs": glyphs_url,
        "sources": {src: {"type": "vector", "tiles": [tiles_url], "minzoom": 0, "maxzoom": MAX_ZOOM, "attribution": "© OpenStreetMap · Protomaps"}},
        "layers": layers,
    }
    if fonts_url:
        out["font-faces"] = igor_faces(fonts_url)
    return out
