"""The marked trails (trails.py): reading Overpass, thinning, the store."""

import importlib.util
import pathlib

_SPEC = importlib.util.spec_from_file_location("nives_trails", pathlib.Path(__file__).resolve().parents[1] / "rootfs/opt/nives/trails.py")
T = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(T)


def test_parse_thin_and_store(tmp_path):
    geom = [{"lat": 48.0 + i * 0.00005, "lon": 2.0} for i in range(200)]  # ~5.5 m apart, ~1.1 km
    els = [
        {"type": "relation", "id": 7, "tags": {"route": "hiking", "network": "nwn", "ref": "GR 2", "name": "Sentier de la Seine", "operator": "FFRandonnée", "distance": "580"},
         "members": [{"type": "way", "geometry": geom}, {"type": "node", "lat": 48, "lon": 2}]},
        {"type": "relation", "id": 8, "tags": {"route": "hiking"}, "members": []},
    ]
    feats = T.parse(els)
    assert len(feats) == 1 and feats[0]["id"] == "r7" and feats[0]["props"]["ref"] == "GR 2"
    line = feats[0]["lines"][0]
    assert 55 <= len(line) <= 80 and line[0] == [2.0, 48.0]
    assert abs(T.length_km(feats[0]["lines"]) - 1.1) < 0.05
    db = T.TrailsDB(tmp_path / "s.sqlite")
    gj = db.put("10/518/352", feats, 1000.0)
    assert gj["features"][0]["properties"]["net"] == "nwn" and gj["features"][0]["geometry"]["type"] == "MultiLineString"
    assert db.get("10/518/352", 1000.0 + 86400)["features"][0]["properties"]["id"] == "r7"
    assert db.get("10/518/352", 1000.0 + T.KEEP_S + 1) is None and db.stale("10/518/352") is not None
    info = db.info("r7")
    assert info["operator"] == "FFRandonnée" and info["network_label"].startswith("GR") and info["km_seen"] == 1.1
    db.put("10/1/1", [], 1000.0)
    assert db.get("10/1/1", 1000.0 + T.EMPTY_KEEP_S + 1) is None
    assert "relation[\"route\"=\"hiking\"]" in T.query((2.0, 48.0, 2.3, 48.2))
