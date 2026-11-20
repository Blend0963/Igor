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
# The lite tile set (weak head units): roads and water only, no text at all —
# the cheapest thing a small CPU can draw. POI stay in the SQLite base.
OSMIUM_LITE_FILTER = "w/highway w/waterway n/natural=water w/natural=water n/water"
TIPPECANOE_LITE_KEEP = ("highway", "waterway", "water", "natural", "layer", "bridge", "tunnel")

# Raster basemap for weak head units: the SAME CARTO dark tiles the card uses
# online (GPS_DARK), pre-downloaded once for the region (z0..RASTER_MAXZOOM,
# overzoom beyond) and served locally. Pure PNG = nothing to decode on the
# head unit's CPU, exactly like Waze. ~40k tiles / <1 Go for France at z14.
RASTER_TILE_URL = "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
RASTER_MAXZOOM = 14
# Rough bounding boxes (minlon, minlat, maxlon, maxlat) per region.
REGION_BBOX = {
    "france": (-5.5, 41.0, 9.9, 51.6), "belgium": (2.4, 49.4, 6.5, 51.6),
    "switzerland": (5.7, 45.7, 10.6, 47.9), "luxembourg": (5.7, 49.4, 6.6, 50.3),
    "germany": (5.8, 47.2, 15.1, 55.1), "spain": (-9.4, 35.9, 3.4, 43.9),
    "italy": (6.6, 35.5, 18.6, 47.2), "europe": (-25.0, 34.0, 45.0, 72.0),
    "world": (-180.0, -85.0, 180.0, 85.0),
}


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
        self.tiles_lite = self.dir / "tiles-lite.pmtiles"
        self.raster_dir = self.dir / "raster"
        self.state_path = self.dir / "state.json"
        self._lock: asyncio.Lock | None = None
        # A previous run killed mid-download (add-on restart) leaves
        # updating=true forever: clear it at startup, the .part file is kept
        # and the download resumes from there.
        st = self._state()
        if st.get("updating"):
            self._write_state(updating=False, step="interrupted", error="interrompu (redémarrage)")

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
            "tiles_lite_bytes": self.tiles_lite.stat().st_size if self.tiles_lite.exists() else 0,
            "raster_ready": self.raster_ready(),
            "raster_tiles": self.raster_count(),
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
    def _check(cmd: list[str]) -> None:
        import shutil
        if shutil.which(cmd[0]) is None:
            raise RuntimeError(
                f"Commande '{cmd[0]}' introuvable dans le conteneur : "
                "rebuild l'image de l'add-on (paquet osmium-tool requis)."
            )

    @classmethod
    def _run_capture(cls, cmd: list[str]) -> subprocess.CompletedProcess:
        cls._check(cmd)
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0:
            raise RuntimeError(
                " ".join(cmd[:2]) + " a échoué (%d): " % proc.returncode
                + proc.stderr.decode(errors="replace")[-400:]
            )
        return proc

    @classmethod
    def _popen_checked(cls, cmd: list[str], **kw) -> subprocess.Popen:
        cls._check(cmd)
        return subprocess.Popen(cmd, **kw)

    @staticmethod
    def _run(cmd: list[str]) -> None:
        import shutil
        if shutil.which(cmd[0]) is None:
            raise RuntimeError(
                f"Commande '{cmd[0]}' introuvable dans le conteneur : "
                "rebuild l'image de l'add-on (paquet osmium-tool requis)."
            )
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
            got = tmp.stat().st_size if tmp.exists() else 0  # resume a partial download
            headers = {"User-Agent": "Igor (Home Assistant)"}
            if got:
                headers["Range"] = f"bytes={got}-"
            req = urllib.request.Request(base + "-latest.osm.pbf", headers=headers)
            mode = "ab" if got else "wb"
            last_write = 0.0
            with urllib.request.urlopen(req, timeout=300) as r, open(tmp, mode) as f:
                cl = int(r.headers.get("Content-Length") or 0)
                total = (cl + got) if cl else \
                    GEOFABRIK_APPROX_BYTES.get(region_path.rsplit("/", 1)[-1], 0)
                while True:
                    chunk = r.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    got += len(chunk)
                    now = time.monotonic()
                    if now - last_write >= 1.0:  # update the bar ~1x/s, not per MB
                        last_write = now
                        pct = max(0, min(39, int(got * 40 / total))) if total else 0
                        self._write_state(updating=True, step="download", downloaded=got, progress=pct)
            os.replace(tmp, self.pbf)
        else:
            self._run(["osmium", "update", str(self.pbf), "--server", base + "-updates"])
        self._write_state(region_path=region_path, stamp=stamp,
                          source_updated=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        return stamp

    def _build_pois(self) -> int:
        self._run(["osmium", "tags-filter", str(self.pbf), *OSMIUM_POI_FILTER.split(),
                   "-o", str(self.pois_pbf), "--overwrite"])
        proc = self._run_capture(["osmium", "export", str(self.pois_pbf), "-f", "geojsonseq", "-o", "-"])
        geo = proc.stdout.decode()
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

    def _tippecanoe(self, out: Path, keep: tuple[str, ...], src: Path | None = None) -> None:
        """osmium export -> geojsonseq -> tippecanoe -> `out` (.pmtiles).
        tippecanoe picks the output format from the extension: the temp file
        must end in .pmtiles or it writes an MBTiles (SQLite) instead."""
        tmp = out.with_suffix(".build.pmtiles") if out.suffix == ".pmtiles" else out.parent / (out.name + ".build.pmtiles")
        if tmp.exists():
            tmp.unlink()
        keep_args = [a for tag in keep for a in ("-y", tag)]
        # NB: no "-o -" — this osmium treats "-" as a literal file and writes
        # a single newline; stdout is the default output anyway.
        export = self._popen_checked(
            ["osmium", "export", str(src or self.pbf), "-f", "geojsonseq"],
            stdout=subprocess.PIPE,
        )
        assert export.stdout is not None
        proc = subprocess.run(
            ["tippecanoe", "-o", str(tmp), "-l", "osm", "-zg", "--no-tile-size-limit",
             "--no-feature-limit", "--drop-densest-as-needed", "--read-parallel", *keep_args],
            stdin=export.stdout, capture_output=True,
        )
        export.stdout.close()
        export.wait()
        if proc.returncode != 0 and not tmp.exists():
            raise RuntimeError("tippecanoe a échoué (%d): %s" % (proc.returncode, proc.stderr.decode(errors="replace")[-400:]))
        os.replace(tmp, out)

    def _build_tiles(self) -> int:
        self._write_state(updating=True, step="tiles", progress=70)
        self._tippecanoe(self.tiles, TIPPECANOE_KEEP)
        # Lite set for weak CPUs (head units): roads + water, no names.
        lite = self.dir / "lite.osm.pbf"
        self._run(["osmium", "tags-filter", str(self.pbf), OSMIUM_LITE_FILTER,
                   "-o", str(lite), "--overwrite"])
        self._tippecanoe(self.tiles_lite, TIPPECANOE_LITE_KEEP, src=lite)
        if lite.exists():
            lite.unlink()
        return self.tiles.stat().st_size

    # ------------------------------------------------------ raster basemap ---

    def raster_ready(self) -> bool:
        marker = self.raster_dir / "done"
        return marker.exists() and any(self.raster_dir.glob("*/*/*.png"))

    def raster_count(self) -> int:
        try:
            return sum(1 for _ in self.raster_dir.glob("*/*/*.png"))
        except OSError:
            return 0

    def _raster_bbox(self, region: str) -> tuple[float, float, float, float]:
        return REGION_BBOX.get(region, (-180.0, -85.0, 180.0, 85.0))

    def _lonlat2tile(self, lon: float, lat: float, z: int) -> tuple[int, int]:
        lat = max(-85.05112878, min(85.05112878, lat))
        n = 2 ** z
        x = int((lon + 180.0) / 360.0 * n)
        y = int((1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n)
        return min(n - 1, max(0, x)), min(n - 1, max(0, y))

    def _download_raster(self, region: str) -> int:
        """Pre-download the CARTO dark PNG tiles for the region (z0..RASTER_MAXZOOM)
        into raster/{z}/{x}/{y}.png — the same tiles the online style uses, so
        the offline raster map is pixel-identical to the online one. Already
        downloaded tiles are skipped, so an interrupted run resumes."""
        minlon, minlat, maxlon, maxlat = self._raster_bbox(region)
        zmax = RASTER_MAXZOOM
        total = 0
        for z in range(0, zmax + 1):
            x0, y1 = self._lonlat2tile(minlon, minlat, z)
            x1, y0 = self._lonlat2tile(maxlon, maxlat, z)
            total += (x1 - x0 + 1) * (y1 - y0 + 1)
        done = 0
        opener = urllib.request.build_opener()
        opener.addheaders = [("User-Agent", "igor-addon-offline-maps/1.0")]
        for z in range(0, zmax + 1):
            x0, y1 = self._lonlat2tile(minlon, minlat, z)
            x1, y0 = self._lonlat2tile(maxlon, maxlat, z)
            for x in range(x0, x1 + 1):
                zdir = self.raster_dir / str(z) / str(x)
                zdir.mkdir(parents=True, exist_ok=True)
                for y in range(y0, y1 + 1):
                    tile = zdir / f"{y}.png"
                    if tile.exists() and tile.stat().st_size > 0:
                        done += 1
                        continue
                    url = RASTER_TILE_URL.format(z=z, x=x, y=y)
                    try:
                        with opener.open(url, timeout=20) as r, open(tile, "wb") as f:
                            f.write(r.read())
                    except Exception:
                        if tile.exists():
                            tile.unlink()
                        continue
                    done += 1
                    if done % 500 == 0:
                        self._write_state(step="raster", progress=min(99, 70 + int(29 * done / max(total, 1))), downloaded=done)
        (self.raster_dir / "done").write_text("ok")
        return done

    def _build_raster(self, region: str) -> int:
        self._write_state(step="raster", progress=70)
        return self._download_raster(region)

    def _update_blocking(self, region: str, force: bool) -> dict:
        region_path = GEOFABRIK_REGIONS.get(region, region)
        self._write_state(updating=True, region=region, step="download", progress=0, error="", downloaded=0)
        try:
            stamp = self._download(region_path, force)
            n_pois = self._build_pois()
            n_tiles = self._build_tiles()
            n_raster = self._build_raster(region)
            self._write_state(updating=False, step="done", progress=100, error="", region=region,
                              updated=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), pois=n_pois)
            return {"ok": True, "region": region, "stamp": stamp, "pois": n_pois, "tiles_bytes": n_tiles, "raster_tiles": n_raster}
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
             "minzoom": 11, "filter": ["in", "class", "park", "forest", "wood"],
             "paint": {"fill-color": "#16241d", "fill-opacity": 0.6}},
            {"id": "roads", "type": "line", "source": "osm", "source-layer": "osm",
             "filter": ["has", "highway"],
             "paint": {"line-color": road_c, "line-width": road_w, "line-opacity": 0.9}},
            {"id": "road-names", "type": "symbol", "source": "osm", "source-layer": "osm",
             "minzoom": 14, "filter": ["all", ["has", "name"], ["==", ["geometry-type"], "LineString"], ["in", ["get", "class"], "motorway", "trunk", "primary", "secondary"]],
             "layout": {"text-field": ["get", "name"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13],
                        "text-font": ["Noto Sans Regular"], "symbol-placement": "line", "text-optional": True},
             "paint": {"text-color": "#8fa3b5", "text-halo-color": "#101820", "text-halo-width": 1}},
            {"id": "poi", "type": "circle", "source": "osm", "source-layer": "osm",
             "minzoom": 15, "filter": ["all", ["has", "amenity"], ["==", ["geometry-type"], "Point"]],
             "paint": {"circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2, 16, 4],
                       "circle-color": "#e0a33a", "circle-stroke-color": "#101820", "circle-stroke-width": 1}},
            {"id": "place-names", "type": "symbol", "source": "osm", "source-layer": "osm",
             "minzoom": 12, "filter": ["all", ["has", "name"], ["==", ["geometry-type"], "Point"],
                                        ["!", ["has", "amenity"]]],
             "layout": {"text-field": ["get", "name"],
                        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 9, 14, 12, 17, 15],
                        "text-font": ["Noto Sans Bold"], "text-anchor": "top", "text-offset": [0, 0.8]},
             "paint": {"text-color": "#c9d4de", "text-halo-color": "#101820", "text-halo-width": 1.2}},
        ],
    }


def offline_style_lite(pmtiles_url: str) -> dict:
    """The zero-text twin of offline_style for weak head units: roads and
    water only, no symbol layers at all — nothing for the small CPU to
    lay out or rasterize. POI stay in the SQLite base (map markers)."""
    road_w = ["interpolate", ["linear"], ["zoom"], 10, 0.6, 13, 2, 16, 5, 18, 9]
    road_c = ["match", ["get", "class"],
              ["motorway", "trunk"], "#3d5a73", ["primary", "secondary", "tertiary"], "#2c4257",
              ["residential", "unclassified", "service"], "#22333f", "#22333f"]
    return {
        "version": 8,
        "name": "Igor offline lite",
        "sources": {"osm": {"type": "vector", "url": f"pmtiles://{pmtiles_url}"}},
        "layers": [
            {"id": "bg", "type": "background", "paint": {"background-color": "#101820"}},
            {"id": "water", "type": "fill", "source": "osm", "source-layer": "osm",
             "filter": ["in", "class", "water", "waterway", "ocean"],
             "paint": {"fill-color": "#12293a"}},
            {"id": "roads", "type": "line", "source": "osm", "source-layer": "osm",
             "filter": ["has", "highway"],
             "paint": {"line-color": road_c, "line-width": road_w, "line-opacity": 0.9}},
        ],
    }


def offline_style_raster(tile_url: str, maxzoom: int = RASTER_MAXZOOM) -> dict:
    """Pure-raster offline style: ONE raster source pointing at the locally
    served CARTO dark PNG tiles (identical to the online GPS_DARK basemap).
    No vector decode, no glyphs, no symbol layout — the head unit only blits
    finished images, so rendering costs nothing (Waze-style). POI markers,
    route line and vehicle arrow are still drawn by the card on top."""
    return {
        "version": 8,
        "name": "Igor offline raster",
        "sources": {
            "carto": {"type": "raster", "tiles": [tile_url], "tileSize": 256, "maxzoom": maxzoom}
        },
        "layers": [{"id": "carto", "type": "raster", "source": "carto"}],
    }
