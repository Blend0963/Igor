"""Tests of the offline maps module (nives/rootfs/opt/nives/offline.py).

Run: python3 -m pytest nives/tests/test_offline.py
The module is stdlib-only, so no Home Assistant is needed here; the build
pipeline (osmium + tippecanoe) is tested with a tiny synthetic .osm file.
"""

import importlib.util
import json
import sqlite3
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
MODULE = HERE.parent / "rootfs" / "opt" / "nives" / "offline.py"
spec = importlib.util.spec_from_file_location("offline", MODULE)
offline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(offline)

OSM_SAMPLE = """<?xml version='1.0' encoding='UTF-8'?>
<osm version='0.6' generator='test'>
  <node id='1' lat='48.8566' lon='2.3522' version='1'>
    <tag k='amenity' v='cafe'/><tag k='name' v='Café de la Gare'/>
    <tag k='addr:housenumber' v='12'/><tag k='addr:street' v='rue de la Paix'/>
    <tag k='wikidata' v='Q123456'/><tag k='wikipedia' v='fr:Café de la Gare'/>
    <tag k='opening_hours' v='Mo-Fr 07:00-18:00'/>
  </node>
  <node id='2' lat='48.8606' lon='2.3376' version='1'>
    <tag k='amenity' v='fuel'/><tag k='name' v='TotalEnergies'/><tag k='brand' v='TotalEnergies'/>
  </node>
  <node id='3' lat='48.8546' lon='2.3376' version='1'>
    <tag k='amenity' v='atm'/><tag k='operator' v='Crédit Agricole'/>
  </node>
  <node id='4' lat='48.8700' lon='2.3100' version='1'>
    <tag k='highway' v='rest_area'/><tag k='name' v='Aire de Versailles'/>
  </node>
  <node id='5' lat='48.8400' lon='2.3800' version='1'>
    <tag k='railway' v='station'/><tag k='name' v='Gare de Versailles'/><tag k='wikidata' v='Q789'/>
  </node>
  <node id='10' lat='48.8566' lon='2.3522' version='1'/>
  <node id='11' lat='48.8570' lon='2.3530' version='1'/>
  <way id='100' version='1'>
    <nd ref='10'/><nd ref='11'/>
    <tag k='highway' v='primary'/><tag k='name' v='Rue de la Paix'/><tag k='maxspeed' v='50'/>
  </way>
</osm>
"""

requires_tools = pytest.mark.skipif(
    not (Path("/usr/bin/osmium").exists() and Path("/usr/bin/tippecanoe").exists()),
    reason="osmium/tippecanoe not installed",
)


def test_kind_of_tags():
    assert offline.kind_of_tags({"amenity": "fuel"}) == "fuel"
    assert offline.kind_of_tags({"amenity": "charging_station"}) == "charging"
    assert offline.kind_of_tags({"highway": "rest_area"}) == "rest"
    assert offline.kind_of_tags({"highway": "services"}) == "rest"
    assert offline.kind_of_tags({"amenity": "atm"}) == "atm"
    assert offline.kind_of_tags({"amenity": "bank", "atm": "yes"}) == "atm"
    assert offline.kind_of_tags({"amenity": "bank"}) == "bank"
    assert offline.kind_of_tags({"railway": "station"}) == "station"
    assert offline.kind_of_tags({"shop": "bakery"}) == "bakery"
    assert offline.kind_of_tags({"natural": "beach"}) == "beach"
    assert offline.kind_of_tags({"highway": "primary"}) is None
    assert offline.kind_of_tags({}) is None


def test_haversine():
    # Paris centre -> Versailles: about 16.6 km as the crow flies.
    d = offline.haversine_m(48.8566, 2.3522, 48.8309, 2.1303)
    assert 15000 < d < 18000
    assert offline.haversine_m(48.85, 2.35, 48.85, 2.35) == 0


def test_fold():
    assert offline.fold("Porte d'Orléans") == "porte d orleans"
    assert offline.fold("  CAFÉ   Élégant ") == "cafe elegant"


@requires_tools
def test_build_pipeline(tmp_path):
    """The whole local build on a synthetic file: osmium tags-filter ->
    geojsonseq -> SQLite (rtree + FTS5), then the queries."""
    osm = tmp_path / "test.osm"
    osm.write_text(OSM_SAMPLE)
    pbf = tmp_path / "test.osm.pbf"
    subprocess.run(["osmium", "cat", str(osm), "-o", str(pbf), "--overwrite"], check=True)

    maps = offline.OfflineMaps(tmp_path / "data")
    # Feed the synthetic extract as the region's pbf, then build.
    maps.pbf = pbf
    n = maps._build_pois()
    assert n == 5  # cafe, fuel, atm, rest_area, gare
    assert maps.db_path.exists()

    # nearby: the 3 kinds within 5 km of Paris centre
    found = maps.nearby(["cafe", "fuel", "atm"], 48.8566, 2.3522, radius_m=5000)
    kinds = sorted(p["kind"] for p in found)
    assert kinds == ["atm", "cafe", "fuel"]
    first = found[0]
    assert first["kind"] == "cafe" and first["distance_m"] < 50

    # rest + station are farther but still within 5 km
    found2 = maps.nearby(["rest", "station"], 48.8566, 2.3522, radius_m=6000)
    assert sorted(p["kind"] for p in found2) == ["rest", "station"]

    # radius too small: nothing
    assert maps.nearby(["fuel"], 48.8566, 2.3522, radius_m=100) == [] or all(
        p["kind"] != "fuel" for p in maps.nearby(["fuel"], 48.8566, 2.3522, radius_m=100)
    )

    # search by name, fuzzy (FTS5 prefix): « gare versail » finds the station
    res = maps.search("gare versail")
    assert any(p["kind"] == "station" for p in res)
    # accent-insensitive: « cafe de la gare » finds the café
    res = maps.search("cafe gare")
    assert res and res[0]["kind"] == "cafe"

    # detail sheet carries wikidata/wikipedia
    info = maps.poi_info(res[0]["id"])
    assert info["wikidata"] == "Q123456"
    assert info["wikipedia"] == "fr:Café de la Gare"
    assert info["tags"]["amenity"] == "cafe"
    assert maps.poi_info(999999) is None

    # status reflects the built base
    st = maps.status()
    assert st["ready"] is False  # no tiles yet
    assert st["pois"] == 5


@requires_tools
def test_tiles_build(tmp_path):
    osm = tmp_path / "test.osm"
    osm.write_text(OSM_SAMPLE)
    pbf = tmp_path / "test.osm.pbf"
    subprocess.run(["osmium", "cat", str(osm), "-o", str(pbf), "--overwrite"], check=True)
    maps = offline.OfflineMaps(tmp_path / "data")
    maps.pbf = pbf
    size = maps._build_tiles()
    assert maps.tiles.exists() and size > 1000
    # A PMTiles file starts with the magic "PMTiles"
    with open(maps.tiles, "rb") as f:
        assert f.read(7) == b"PMTiles"


def test_offline_style_lite():
    style = offline.offline_style_lite("https://ha.local/api/nives/offline/tiles-lite.pmtiles")
    assert style["version"] == 8
    assert style["sources"]["osm"]["url"] == "pmtiles://https://ha.local/api/nives/offline/tiles-lite.pmtiles"
    layer_ids = {l["id"] for l in style["layers"]}
    # lite: no symbol layers at all (nothing for a weak CPU to rasterize)
    assert not any(l["type"] == "symbol" for l in style["layers"])
    assert {"bg", "water", "roads"} <= layer_ids


def test_offline_style():
    style = offline.offline_style("https://ha.local/api/nives/offline/tiles.pmtiles")
    assert style["version"] == 8
    assert style["sources"]["osm"]["url"] == "pmtiles://https://ha.local/api/nives/offline/tiles.pmtiles"
    layer_ids = {l["id"] for l in style["layers"]}
    assert {"bg", "water", "roads", "road-names", "poi", "place-names"} <= layer_ids


def test_status_empty(tmp_path):
    maps = offline.OfflineMaps(tmp_path / "empty")
    st = maps.status()
    assert st["ready"] is False and st["pois"] == 0 and st["region"] is None
    assert maps.nearby(["fuel"], 48.85, 2.35) == []
    assert maps.search("gare") == []
    assert maps.poi_info(1) is None


def test_offline_style_raster():
    style = offline.offline_style_raster("https://ha.local/api/nives/offline/raster/{z}/{x}/{y}.png")
    assert style["version"] == 8
    src = style["sources"]["carto"]
    assert src["type"] == "raster" and src["tiles"] == ["https://ha.local/api/nives/offline/raster/{z}/{x}/{y}.png"]
    # one single raster layer: no vector source, no glyphs, no symbol layer
    assert len(style["layers"]) == 1 and style["layers"][0]["type"] == "raster"
    assert "glyphs" not in style


def test_raster_tile_math():
    # Paris at z14 must land in the expected tile
    x, y = offline.OfflineMaps.__new__(offline.OfflineMaps)._lonlat2tile(2.3522, 48.8566, 14)
    assert (x, y) == (8299, 5636)  # Paris z14
