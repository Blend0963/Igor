"""The TomTom basemap relay: addresses and tile bounds (traffic.py)."""

import importlib.util
import json
import pathlib

_SPEC = importlib.util.spec_from_file_location(
    "nives_traffic", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/traffic.py"
)
traffic = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(traffic)


def test_known_good_address_first():
    urls = traffic.basemap_urls("K", 15, 16598, 11273, first=2)
    assert [i for i, _ in urls] == [2, 0, 1]
    assert urls[0][1].endswith("/night/15/16598/11273.png?tileSize=512&key=K")


def test_every_address_has_key_and_tile():
    for _, u in traffic.basemap_urls("K", 3, 4, 5):
        assert "key=K" in u and "/3/4/5" in u and "tileSize=512" in u


def test_tile_bounds():
    assert traffic.tile_ok(0, 0, 0)
    assert traffic.tile_ok(15, 32767, 0)
    assert not traffic.tile_ok(15, 32768, 0)
    assert not traffic.tile_ok(23, 0, 0)
    assert not traffic.tile_ok(-1, 0, 0)


def test_strip_key():
    assert traffic.strip_key("a.json?key=K") == "a.json"
    assert traffic.strip_key("a?key=K&b=1") == "a?b=1"
    assert traffic.strip_key("a?b=1&key=K") == "a?b=1"
    assert traffic.strip_key("a?b=1&key=K&c=2") == "a?b=1&c=2"


def test_with_key():
    assert traffic.with_key("maps/x.pbf", "K") == "https://api.tomtom.com/maps/x.pbf?key=K"
    assert traffic.with_key("maps/x?a=1&key=OLD", "K") == "https://api.tomtom.com/maps/x?a=1&key=K"


def test_rewrite_json_hides_tomtom_and_key():
    src = '{"tiles":["https://api.tomtom.com/maps/orbis/{z}/{x}/{y}.pbf?apiVersion=1&key=SECRET"],' \
          '"glyphs":"https:\\/\\/api.tomtom.com\\/maps\\/glyphs/{fontstack}/{range}.pbf?key=SECRET",' \
          '"sprite":"https://api.tomtom.com/maps/sprite?key=SECRET"}'
    out = traffic.rewrite_json(src, "https://ha/api/nives/tomtom/")
    assert "SECRET" not in out and "api.tomtom.com" not in out
    d = json.loads(out)
    assert d["tiles"] == ["https://ha/api/nives/tomtom/maps/orbis/{z}/{x}/{y}.pbf?apiVersion=1"]
    assert d["glyphs"] == "https://ha/api/nives/tomtom/maps/glyphs/{fontstack}/{range}.pbf"
    assert d["sprite"] == "https://ha/api/nives/tomtom/maps/sprite"


def test_relay_only_maps():
    assert traffic.relay_ok("maps/orbis/x.pbf")
    assert not traffic.relay_ok("search/2/search/x.json")
    assert not traffic.relay_ok("maps/../search")
