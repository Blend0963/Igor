"""Offline maps for the GPS card: the OpenStreetMap data of a region is
downloaded once (Geofabrik's daily extract), cut into POI (a SQLite base the
card queries instead of Overpass) and into vector tiles (a single PMTiles
file this integration serves itself), so the map, the places and the search
keep working when TomTom's quota is gone, when Overpass is on strike — and
mostly without the network at all.

The master copy lives on the Home Assistant server (<config>/nives_offline);
the head unit keeps its own copy in the browser cache (MapLibre caches the
PMTiles range requests), exactly like the regions Organic Maps downloads.
`nives.car_map_update` refreshes it (Geofabrik's daily diffs), and the card's
menu gets a button that calls the same service.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import sqlite3
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any

GEOFABRIK_BASE = "https://download.geofabrik.de"
# Rough pbf sizes (bytes), used to show a progress % even when the server
# answers in chunked mode with no Content-Length.
GEOFABRIK_APPROX_BYTES = {
    "france": 4_500_000_000, "belgium": 900_000_000, "switzerland": 700_000_000,
    "luxembourg": 50_000_000, "germany": 4_000_000_000, "spain": 1_900_000_000,
    "italy": 2_200_000_000, "europe": 26_000_000_000, "planet": 75_000_000_000,
}
GEOFABRIK_REGIONS = {
    "france": "europe/france",
    "belgium": "europe/belgium",
    "switzerland": "europe/switzerland",
    "luxembourg": "europe/luxembourg",
    "germany": "europe/germany",
    "spain": "europe/spain",
    "italy": "europe/italy",
    "europe": "europe",
    "world": "planet",
}
# The tags kept for the POI base: every kind the card knows (car.KINDS).
OSMIUM_POI_FILTER = (
    "n/amenity n/shop n/tourism n/railway n/highway n/natural n/aeroway "
    "w/amenity w/shop w/tourism w/railway w/highway=rest_area w/highway=services "
    "w/natural=beach w/aeroway=aerodrome"
)
TIPPECANOE_KEEP = ("name", "amenity", "shop", "tourism", "railway", "highway",
                   "natural", "aeroway", "maxspeed", "oneway", "layer", "bridge", "tunnel")


def kind_of_tags(p: dict) -> str | None:
    """An OSM tag set -> the card's kind (the same keys as car.KINDS)."""
    a, s, t = p.get("amenity"), p.get("shop"), p.get("tourism")
    h, r, n, aw = p.get("highway"), p.get("railway"), p.get("natural"), p.get("aeroway")
    if a == "fuel":
        return "fuel"
    if a == "charging_station":
        return "charging"
    if a == "parking":
        return "parking"
    if h in ("rest_area", "services"):
        return "rest"
    if a == "toilets":
        return "toilets"
    if a == "hospital":
        return "hospital"
    if a == "pharmacy":
        return "pharmacy"
    if a == "atm" or (a == "bank" and p.get("atm") == "yes"):
        return "atm"
    if s == "supermarket":
        return "supermarket"
    if a in ("restaurant", "fast_food"):
        return "restaurant"
    if a == "cafe":
        return "cafe"
    if a == "car_wash":
        return "car_wash"
    if s == "car_repair":
        return "car_repair"
    if t in ("hotel", "motel", "guest_house"):
        return "hotel"
    if t in ("camp_site", "caravan_site"):
        return "camping"
    if s == "bakery":
        return "bakery"
    if a == "bank":
        return "bank"
    if a == "post_office":
        return "post"
    if a == "police":
        return "police"
    if t == "attraction":
        return "attraction"
    if t == "museum":
        return "museum"
    if a == "cinema":
        return "cinema"
    if t == "theme_park":
        return "theme_park"
    if t == "zoo":
        return "zoo"
    if n == "beach":
        return "beach"
    if r in ("station", "halt"):
        return "station"
    if aw == "aerodrome":
        return "airport"
    if a == "car_rental":
        return "car_rental"
    return None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def fold(text: str) -> str:
    import re
    import unicodedata

    t = str(text or "").replace("’", " ").replace("'", " ")
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", t).strip()


class OfflineMaps:
    """One region's OSM data, on disk, queried without any network."""

    def __init__(self, data_dir: Path) -> None:
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.pbf = self.dir / "region.osm.pbf"
        self.pois_pbf = self.dir / "pois.osm.pbf"
        self.db_path = self.dir / "pois.db"
        self.tiles = self.dir / "tiles.pmtiles"
        self.state_path = self.dir / "state.json"
        self._lock: asyncio.Lock | None = None

    def lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    # ------------------------------------------------------------- status ---

    def status(self) -> dict:
        state = self._state()
        return {
            "ready": self.db_path.exists() and self.tiles.exists(),
            "region": state.get("region"),
            "updated": state.get("updated"),
            "source_updated": state.get("source_updated"),
            "pois": self._count() if self.db_path.exists() else 0,
            "pbf_bytes": self.pbf.stat().st_size if self.pbf.exists() else 0,
            "tiles_bytes": self.tiles.stat().st_size if self.tiles.exists() else 0,
            "updating": bool(state.get("updating")),
            "step": state.get("step", ""),
            "progress": int(state.get("progress") or 0),
            "downloaded_bytes": int(state.get("downloaded") or 0),
            "error": state.get("error", ""),
        }

    def _count(self) -> int:
        try:
            with sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True) as db:
                return int(db.execute("SELECT COUNT(*) FROM pois").fetchone()[0])
        except sqlite3.Error:
            return 0

    # ------------------------------------------------------------- queries ---

    def nearby(self, kinds: list[str], lat: float, lon: float, radius_m: float = 5000.0, limit: int = 60) -> list[dict]:
        """The POI of the kinds within `radius_m` of a point, nearest first."""
        if not self.db_path.exists() or not kinds:
            return []
        dlat = radius_m / 111320.0
        dlon = radius_m / max(1.0, 111320.0 * math.cos(math.radians(lat)))
        ph = ",".join("?" * len(kinds))
        sql = (
            "SELECT p.id, p.kind, p.name, p.brand, p.lat, p.lon, p.street, p.housenumber, p.city, "
            "p.phone, p.website, p.opening_hours, p.wikidata, p.wikipedia "
            "FROM pois p JOIN poi_rtree r ON p.id = r.id "
            f"WHERE r.minlon <= ? AND r.maxlon >= ? AND r.minlat <= ? AND r.maxlat >= ? AND p.kind IN ({ph})"
        )
        args: list[Any] = [lon + dlon, lon - dlon, lat + dlat, lat - dlat, *kinds]
        out: list[tuple[float, dict]] = []
        with sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            for row in db.execute(sql, args):
                d = haversine_m(lat, lon, row["lat"], row["lon"])
                if d <= radius_m:
                    p = dict(row)
                    p["distance_m"] = round(d)
                    out.append((d, p))
        out.sort(key=lambda x: x[0])
        return [p for _, p in out[:limit]]

    def poi_info(self, poi_id: int) -> dict | None:
        """The whole row of one POI (the card's detail sheet, wikidata included)."""
        if not self.db_path.exists():
            return None
        with sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT * FROM pois WHERE id = ?", (poi_id,)).fetchone()
            if not row:
                return None
            p = dict(row)
            p["tags"] = json.loads(p.pop("tags") or "{}")
            return p

    def search(self, query: str, near: tuple[float, float] | None = None, limit: int = 8) -> list[dict]:
        """A POI by its name (FTS5, accent- and case-insensitive), biased to
        `near` when given — the offline replacement of TomTom's text search."""
        if not self.db_path.exists():
            return []
        words = [w for w in fold(query).split() if len(w) >= 2]
        if not words:
            return []
        match = " OR ".join(w + "*" for w in words)
        sql = (
            "SELECT p.*, bm25(poi_names) AS rank FROM poi_names "
            "JOIN pois p ON p.id = poi_names.rowid WHERE poi_names MATCH ? ORDER BY rank LIMIT ?"
        )
        out: list[dict] = []
        with sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True) as db:
            db.row_factory = sqlite3.Row
            for row in db.execute(sql, (match, limit * 4)):
                p = dict(row)
                p.pop("rank", None)
                if near:
                    p["distance_m"] = round(haversine_m(near[1], near[0], p["lat"], p["lon"]))
                out.append(p)
        if near:
            out.sort(key=lambda p: p.get("distance_m", 1e18))
        return out[:limit]

    # ------------------------------------------------------------- update ---

    async def update(self, region: str = "france", force: bool = False) -> dict:
        """Download (or refresh with the daily diffs) the region, rebuild the
        POI base and the tiles. Heavy: runs in the executor."""
        async with self.lock():
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, self._update_blocking, region, force)

    def _state(self) -> dict:
        if self.state_path.exists():
            try:
                return json.loads(self.state_path.read_text())
            except Exception:  # noqa: BLE001 - a half-written file
                return {}
        return {}

    def _write_state(self, **kw) -> None:
        state = self._state()
        state.update(kw)
        tmp = self.state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1))
        os.replace(tmp, self.state_path)

    @staticmethod
    def _run(cmd: list[str]) -> None:
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(
                " ".join(cmd[:2]) + " a échoué (%d): " % proc.returncode
                + proc.stderr.decode(errors="replace")[-400:]
            )

    def _download(self, region_path: str, force: bool) -> str:
        base = f"{GEOFABRIK_BASE}/{region_path}"
        stamp = ""
        last: Exception | None = None
        for attempt in range(3):
            try:
                with urllib.request.urlopen(base + "-updates/state.txt", timeout=30) as r:
                    for line in r.read().decode().splitlines():
                        if line.startswith(("sequenceNumber=", "timestamp=")):
                            stamp += line.strip() + " "
                last = None
                break
            except Exception as err:  # noqa: BLE001 - retried
                last = err
        if last:
            raise RuntimeError(f"Geofabrik injoignable: {last}")
        stamp = stamp.strip()
        state = self._state()
        fresh = (not force) and self.pbf.exists() and state.get("region_path") == region_path and state.get("stamp") == stamp
        if fresh:
            return stamp
        if not self.pbf.exists() or force or state.get("region_path") != region_path:
            tmp = self.pbf.with_suffix(".pbf.part")
            req = urllib.request.Request(base + "-latest.osm.pbf", headers={"User-Agent": "Igor (Home Assistant)"})
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
                total = int(r.headers.get("Content-Length") or 0) or \
                    GEOFABRIK_APPROX_BYTES.get(region_path.rsplit("/", 1)[-1], 0)
                got = 0
                while True:
                    chunk = r.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    got += len(chunk)
                    if total:
                        self._write_state(updating=True, step="download", downloaded=got,
                                          progress=max(0, min(39, int(got * 40 / total))))
            os.replace(tmp, self.pbf)
        else:
            self._run(["osmium", "update", str(self.pbf), "--server", base + "-updates"])
        self._write_state(region_path=region_path, stamp=stamp,
                          source_updated=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        return stamp

    def _build_pois(self) -> int:
        self._run(["osmium", "tags-filter", str(self.pbf), *OSMIUM_POI_FILTER.split(),
                   "-o", str(self.pois_pbf), "--overwrite"])
        geo = subprocess.run(
            ["osmium", "export", str(self.pois_pbf), "-f", "geojsonseq", "-o", "-"],
            capture_output=True, check=True,
        ).stdout.decode()
        db_tmp = self.db_path.with_suffix(".db.tmp")
        if db_tmp.exists():
            db_tmp.unlink()
        db = sqlite3.connect(db_tmp)
        db.execute("PRAGMA journal_mode=OFF")
        db.execute("PRAGMA synchronous=OFF")
        db.execute(
            """CREATE TABLE pois(
                 id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT, brand TEXT,
                 lat REAL NOT NULL, lon REAL NOT NULL,
                 street TEXT, housenumber TEXT, city TEXT, phone TEXT, website TEXT,
                 opening_hours TEXT, wikidata TEXT, wikipedia TEXT, tags TEXT NOT NULL)"""
        )
        db.execute("CREATE VIRTUAL TABLE poi_rtree USING rtree(id, minlon, maxlon, minlat, maxlat)")
        db.execute("CREATE VIRTUAL TABLE poi_names USING fts5(name, brand, content='pois', content_rowid='id')")
        n = 0
        for line in geo.splitlines():
            if not line.strip():
                continue
            f = json.loads(line)
            p = f.get("properties") or {}
            kind = kind_of_tags(p)
            if not kind:
                continue
            geom = f["geometry"]
            if geom["type"] == "Point":
                lon, lat = geom["coordinates"][:2]
            else:  # a building/area POI: its centroid
                pts: list = []
                def _walk(c):
                    if isinstance(c[0], (int, float)):
                        pts.append(c)
                    else:
                        for x in c:
                            _walk(x)
                _walk(geom["coordinates"])
                lon = sum(q[0] for q in pts) / len(pts)
                lat = sum(q[1] for q in pts) / len(pts)
            cur = db.execute(
                """INSERT INTO pois(kind,name,brand,lat,lon,street,housenumber,city,phone,website,
                     opening_hours,wikidata,wikipedia,tags) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (kind, p.get("name"), p.get("brand"), lat, lon, p.get("addr:street"),
                 p.get("addr:housenumber"), p.get("addr:city"), p.get("phone"), p.get("website"),
                 p.get("opening_hours"), p.get("wikidata"), p.get("wikipedia"),
                 json.dumps(p, ensure_ascii=False)),
            )
            db.execute("INSERT INTO poi_rtree VALUES(?,?,?,?,?)", (cur.lastrowid, lon, lon, lat, lat))
            db.execute("INSERT INTO poi_names(rowid, name, brand) VALUES(?,?,?)",
                       (cur.lastrowid, p.get("name") or "", p.get("brand") or ""))
            n += 1
            if n % 100000 == 0:
                self._write_state(updating=True, step="pois", progress=min(69, 40 + n // 100000))
        db.execute("CREATE INDEX idx_pois_kind ON pois(kind)")
        db.commit()
        db.close()
        os.replace(db_tmp, self.db_path)
        return n

    def _build_tiles(self) -> int:
        self._write_state(updating=True, step="tiles", progress=70)
        keep = [a for tag in TIPPECANOE_KEEP for a in ("-y", tag)]
        export = subprocess.Popen(
            ["osmium", "export", str(self.pbf), "-f", "geojsonseq", "-o", "-"],
            stdout=subprocess.PIPE,
        )
        # tippecanoe picks the output format from the extension: the temp
        # file must end in .pmtiles or it writes an MBTiles (SQLite) instead.
        tmp = self.dir / "tiles.build.pmtiles"
        if tmp.exists():
            tmp.unlink()
        assert export.stdout is not None
        proc = subprocess.run(
            ["tippecanoe", "-o", str(tmp), "-l", "osm", "-zg", "--no-tile-size-limit",
             "--no-feature-limit", "--drop-densest-as-needed", "--read-parallel", *keep],
            stdin=export.stdout, capture_output=True,
        )
        export.stdout.close()
        export.wait()
        if proc.returncode != 0:
            raise RuntimeError("tippecanoe a échoué (%d): %s" % (proc.returncode, proc.stderr.decode(errors="replace")[-400:]))
        os.replace(tmp, self.tiles)
        return self.tiles.stat().st_size

    def _update_blocking(self, region: str, force: bool) -> dict:
        region_path = GEOFABRIK_REGIONS.get(region, region)
        self._write_state(updating=True, region=region, step="download", progress=0, error="", downloaded=0)
        try:
            stamp = self._download(region_path, force)
            n_pois = self._build_pois()
            n_tiles = self._build_tiles()
            self._write_state(updating=False, step="done", progress=100, error="", region=region,
                              updated=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), pois=n_pois)
            return {"ok": True, "region": region, "stamp": stamp, "pois": n_pois, "tiles_bytes": n_tiles}
        except Exception as err:  # noqa: BLE001 - reported to the caller
            self._write_state(updating=False, step="error", error=str(err))
            return {"ok": False, "error": str(err)}


def offline_style(pmtiles_url: str) -> dict:
    """A small MapLibre style reading the PMTiles « osm » layer: dark, in
    Igor's look — the offline twin of the CARTO dark style."""
    road_w = ["interpolate", ["linear"], ["zoom"], 10, 0.6, 13, 2, 16, 5, 18, 9]
    road_c = ["match", ["get", "class"],
              ["motorway", "trunk"], "#3d5a73", ["primary", "secondary", "tertiary"], "#2c4257",
              ["residential", "unclassified", "service"], "#22333f", "#22333f"]
    return {
        "version": 8,
        "name": "Igor offline",
        "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        "sources": {"osm": {"type": "vector", "url": f"pmtiles://{pmtiles_url}"}},
        "layers": [
            {"id": "bg", "type": "background", "paint": {"background-color": "#101820"}},
            {"id": "water", "type": "fill", "source": "osm", "source-layer": "osm",
             "filter": ["in", "class", "water", "waterway", "ocean"],
             "paint": {"fill-color": "#12293a"}},
            {"id": "landuse", "type": "fill", "source": "osm", "source-layer": "osm",
             "filter": ["in", "class", "park", "forest", "wood", "grass", "pitch"],
             "paint": {"fill-color": "#16241d", "fill-opacity": 0.8}},
            {"id": "buildings", "type": "fill", "source": "osm", "source-layer": "osm",
             "minzoom": 14, "filter": ["==", ["geometry-type"], "Polygon"],
             "paint": {"fill-color": "#1b2836", "fill-outline-color": "#24394a"}},
            {"id": "roads", "type": "line", "source": "osm", "source-layer": "osm",
             "filter": ["has", "highway"],
             "paint": {"line-color": road_c, "line-width": road_w, "line-opacity": 0.9}},
            {"id": "road-names", "type": "symbol", "source": "osm", "source-layer": "osm",
             "minzoom": 12, "filter": ["all", ["has", "name"], ["==", ["geometry-type"], "LineString"]],
             "layout": {"text-field": ["get", "name"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13],
                        "text-font": ["Noto Sans Regular"], "symbol-placement": "line", "text-optional": True},
             "paint": {"text-color": "#8fa3b5", "text-halo-color": "#101820", "text-halo-width": 1}},
            {"id": "poi", "type": "circle", "source": "osm", "source-layer": "osm",
             "minzoom": 13, "filter": ["all", ["has", "amenity"], ["==", ["geometry-type"], "Point"]],
             "paint": {"circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 4],
                       "circle-color": "#e0a33a", "circle-stroke-color": "#101820", "circle-stroke-width": 1}},
            {"id": "place-names", "type": "symbol", "source": "osm", "source-layer": "osm",
             "minzoom": 10, "filter": ["all", ["has", "name"], ["==", ["geometry-type"], "Point"],
                                        ["!", ["has", "amenity"]]],
             "layout": {"text-field": ["get", "name"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 12, 17, 15],
                        "text-font": ["Noto Sans Bold"], "text-anchor": "top", "text-offset": [0, 0.8]},
             "paint": {"text-color": "#c9d4de", "text-halo-color": "#101820", "text-halo-width": 1.2}},
        ],
    }
