"""Igor's library of places (places.py): the squares, the query, the reading, the store."""

import importlib.util
import pathlib

_SPEC = importlib.util.spec_from_file_location("nives_places", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/places.py")
P = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(P)


def test_cells_cover_france_and_split():
    cs = P.cells()
    assert len(cs) == 60 * 40
    assert cs[0] == (-5.25, 41.25, -5.0, 41.5) and cs[-1][2:] == (9.75, 51.25)
    q = P.split((2.0, 48.0, 2.25, 48.25))
    assert q[0] == (2.0, 48.0, 2.125, 48.125) and q[3] == (2.125, 48.125, 2.25, 48.25)
    assert '(48.0,2.0,48.25,2.25)' in P.query((2.0, 48.0, 2.25, 48.25))


def test_classify_and_rank():
    assert P.classify({"tourism": "viewpoint"}) == ("attraction", "viewpoint")
    assert P.classify({"amenity": "fuel"}) is None
    assert P.classify({"amenity": "restaurant"}) == ("restaurant", "restaurant")
    assert P.classify({"shop": "bakery"}) == ("bakery", "bakery")
    assert P.classify({"shop": "hardware"}) == ("shop", "shop")
    assert P.classify({"tourism": "information", "information": "board"}) is None
    assert P.classify({"railway": "station", "station": "subway"}) == ("railway", "subway")
    assert P.classify({"highway": "bus_stop"}) == ("bus", "bus_stop")
    assert P.rank({"tourism": "viewpoint"}, "viewpoint") == 1
    assert P.rank({"name": "X", "wikidata": "Q1"}, "restaurant") == 2
    assert P.rank({"name": "X"}, "restaurant") == 3
    assert P.rank({}, "toilets") == 4 and P.rank({}, "bus_stop") == 5


def test_parse_store_query(tmp_path):
    els = [
        {"type": "node", "id": 1, "lat": 48.1, "lon": 2.1, "tags": {"amenity": "restaurant", "name": "Chez Paul", "opening_hours": "Mo-Su 12:00-22:00"}},
        {"type": "way", "id": 2, "center": {"lat": 48.2, "lon": 2.2}, "tags": {"tourism": "viewpoint", "name": "Belvédère"}},
        {"type": "node", "id": 3, "lat": 48.15, "lon": 2.15, "tags": {"amenity": "bench"}},
        {"type": "node", "id": 4, "lat": 49.0, "lon": 2.1, "tags": {"amenity": "cafe"}},
    ]
    rows = P.parse(els)
    assert [r[0] for r in rows] == ["n1", "w2", "n4"]
    db = P.PlacesDB(tmp_path / "lieux.sqlite")
    cell = (2.0, 48.0, 2.25, 48.25)
    db.seed([cell, (2.25, 48.0, 2.5, 48.25)])
    assert db.next_cell(1000.0) in (cell, (2.25, 48.0, 2.5, 48.25))
    db.store(cell, rows, 1000.0)  # n4 lies outside the square: left to its own
    got = db.places((2.0, 48.0, 2.3, 48.3))
    assert sorted(g[0] for g in got) == ["n1", "w2"] and got[0][0] == "w2"  # the view first (rank 1)
    assert db.places((2.0, 48.0, 2.3, 48.3), max_rank=2)[0][0] == "w2" and len(db.places((2.0, 48.0, 2.3, 48.3), max_rank=2)) == 1
    assert db.complete((2.0, 48.0, 2.2, 48.2)) and not db.complete((2.2, 48.0, 2.4, 48.2))
    assert db.info("n1")["opening_hours"] == "Mo-Su 12:00-22:00"
    db.store(cell, rows[:1], 2000.0)  # asked again a month later: replaced, not doubled
    assert [g[0] for g in db.places((2.0, 48.0, 2.3, 48.3))] == ["n1"]
    st = db.status()
    assert st["places"] == 1 and st["cells_done"] == 1 and st["cells_total"] == 2
    db.failed((2.25, 48.0, 2.5, 48.25), "Overpass 504", 3000.0)
    assert db.next_cell(3000.0) is None and db.next_cell(3000.0 + 1300) == (2.25, 48.0, 2.5, 48.25)
    db.replace_cell((2.25, 48.0, 2.5, 48.25), P.split((2.25, 48.0, 2.5, 48.25)))
    assert db.status()["cells_total"] == 5


def test_near_sorted_with_sheet(tmp_path):
    db = P.PlacesDB(tmp_path / "l.sqlite")
    cell = (2.0, 48.0, 2.25, 48.25)
    db.store(cell, P.parse([
        {"type": "node", "id": 1, "lat": 48.100, "lon": 2.100, "tags": {"amenity": "restaurant", "name": "Près", "cuisine": "french"}},
        {"type": "node", "id": 2, "lat": 48.110, "lon": 2.100, "tags": {"amenity": "restaurant", "name": "Loin"}},
        {"type": "node", "id": 3, "lat": 48.101, "lon": 2.100, "tags": {"amenity": "pharmacy", "name": "Pharma"}},
        {"type": "node", "id": 4, "lat": 48.200, "lon": 2.200, "tags": {"amenity": "restaurant", "name": "Hors"}},
    ]), 1.0)
    got = db.near([(48.1, 2.1)], 2000, ["restaurant"])
    assert [g["name"] for g in got] == ["Près", "Loin"] and got[0]["cuisine"] == "french" and got[0]["d"] == 0
    assert {g["name"] for g in db.near([(48.1, 2.1)], 500)} == {"Près", "Pharma"}
    assert [g["name"] for g in db.near([(48.1, 2.1), (48.2, 2.2)], 300, ["restaurant"])] == ["Près", "Hors"]
