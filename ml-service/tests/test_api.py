import pandas as pd
from fastapi.testclient import TestClient

import app.main as m


def make_client(tmp_path, monkeypatch):
    d1, d2 = pd.Timestamp("2022-09-09").date(), pd.Timestamp("2022-09-10").date()
    pd.DataFrame({
        "edge_id": [1, 2, 3], "day": [d1, d1, d2], "rank": [1, 2, 1],
        "src": ["a", "b", "c"], "dst": ["x", "y", "z"], "amt_paid": [10.0, 20.0, 30.0],
        "p": [0.9, 0.5, 0.8], "band": ["confident alert", "uncertain", "confident alert"],
        "label": [1, 0, 1],
    }).to_parquet(tmp_path / "T_alerts_test.parquet")
    monkeypatch.setattr(m, "PROCESSED_DIR", tmp_path)
    m._load_alerts.cache_clear()
    return TestClient(m.app)


def test_days(tmp_path, monkeypatch):
    r = make_client(tmp_path, monkeypatch).get("/days", params={"dataset": "T"}).json()
    assert [d["day"] for d in r["days"]] == ["2022-09-09", "2022-09-10"]
    assert r["days"][0]["bands"] == {"confident alert": 1, "uncertain": 1}


def test_alerts_filter_and_order(tmp_path, monkeypatch):
    r = make_client(tmp_path, monkeypatch).get("/alerts", params={"dataset": "T", "day": "2022-09-09"}).json()
    assert [a["edge_id"] for a in r["alerts"]] == [1, 2]


def test_label_hidden_unless_debug(tmp_path, monkeypatch):
    c = make_client(tmp_path, monkeypatch)
    assert "label" not in c.get("/alerts", params={"dataset": "T"}).json()["alerts"][0]
    assert "label" in c.get("/alerts", params={"dataset": "T", "debug": True}).json()["alerts"][0]


def test_missing_dataset_is_404(tmp_path, monkeypatch):
    assert make_client(tmp_path, monkeypatch).get("/alerts", params={"dataset": "NOPE"}).status_code == 404


def test_bad_dataset_name_is_400(tmp_path, monkeypatch):
    assert make_client(tmp_path, monkeypatch).get("/alerts", params={"dataset": "../x"}).status_code == 400