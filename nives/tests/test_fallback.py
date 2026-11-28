"""The spare map (fallback.py): PMTiles ids and directories, pieces, store."""

import gzip
import importlib.util
import pathlib

_SPEC = importlib.util.spec_from_file_location("nives_fallback", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/fallback.py")
F = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(F)


def test_tile_ids_follow_the_pmtiles_spec():
    assert [F.tile_id(0, 0, 0), F.tile_id(1, 0, 0), F.tile_id(1, 0, 1), F.tile_id(1, 1, 1), F.tile_id(1, 1, 0)] == [0, 1, 2, 3, 4]
    assert F.tile_id(2, 0, 0) == 5 and F.tile_id(12, 3423, 1763) == 19078479


def test_piece_ranges_hold_every_descendant():
    piece = "8/129/88"
    rng = F.piece_ranges(piece)
    assert len(rng) == F.MAX_ZOOM - 8 + 1
    for z in (8, 10, 14):
        k = 1 << (z - 8)
        for dx, dy in ((0, 0), (k - 1, 0), (0, k - 1), (k - 1, k - 1), (k // 2, k // 3)):
            t = F.tile_id(z, 129 * k + dx, 88 * k + dy)
            assert any(a <= t <= b for a, b in rng)
    outside = F.tile_id(10, 130 * 4, 88 * 4)
    assert not any(a <= outside <= b for a, b in rng)
    assert F.pieces()[0] == "low" and len(F.pieces()) > 50


def test_directory_round_trip_leaves_and_spans():
    entries = [(0, 0, 100, 1), (5, 100, 50, 3), (9, 150, 20, 1), (40, 0, 999, 0)]
    raw = F.write_directory(entries)
    assert F.read_directory(gzip.compress(raw), 2) == entries
    assert F.read_directory(raw, 1) == entries
    assert F.tiles_for(entries, [(6, 6)]) == [(5, 100, 50, 3)]
    assert F.leaves_for(entries, [(50, 60)]) == [(0, 999)] and F.leaves_for(entries, [(10, 20)]) == []
    assert F.byte_spans([(1, 0, 10, 1), (2, 10, 10, 1), (3, 1_000_000, 5, 1)], gap=100) == [(0, 20), (1_000_000, 1_000_005)]


def test_header():
    import struct
    b = b"PMTiles" + bytes([3]) + struct.pack("<11Q", 127, 10, 0, 0, 200, 30, 300, 1000, 5, 5, 4) + bytes([1, 2, 2, 1, 0, 14]) + b"\0" * 30
    h = F.read_header(b)
    assert h["root_offset"] == 127 and h["data_offset"] == 300 and h["tile_compression"] == 2 and h["max_zoom"] == 14


def test_store_runs_and_dedupe(tmp_path):
    m = F.SpareMap(tmp_path / "carte.sqlite")
    m.seed(["low", "8/1/1"], "b1")
    assert m.next_piece(0) in ("low", "8/1/1")
    t = F.tile_id(3, 2, 2)
    m.store("low", "b1", [(t, 0, 3, 2), (t + 5, 0, 3, 1)], {(0, 3): b"abc"})
    assert m.tile(3, 2, 2) == b"abc" and m.status()["tiles"] == 2
    st = m.status()
    assert st["pieces_done"] == 1 and st["usable"] and not st["ready"]
    m.seed(["low", "8/1/1"], "b2")  # a new build: everything again, the old tiles meanwhile
    assert m.status()["pieces_done"] == 0 and m.tile(3, 2, 2) == b"abc"
    assert m.font("Noto/0-255", b"x") == b"x" and m.font("Noto/0-255") == b"x"
    s = F.style("https://h/api/nives/spare/{z}/{x}/{y}.mvt", "https://h/api/nives/spare/fonts/{fontstack}/{range}.pbf", "jour")
    assert s["sources"]["spare"]["tiles"][0].endswith(".mvt") and s["layers"][0]["paint"]["background-color"] == "#d3e2c6"
