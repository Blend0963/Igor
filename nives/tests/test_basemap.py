"""The TomTom basemap relay: addresses and tile bounds (traffic.py)."""

import importlib.util
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
