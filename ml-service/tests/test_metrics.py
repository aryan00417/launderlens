import pandas as pd

from app.metrics import recall_at_k_per_day


def test_recall_at_k_per_day():
    df = pd.DataFrame({
        "ts": pd.to_datetime(["2022-09-01 01:00", "2022-09-01 02:00", "2022-09-02 01:00", "2022-09-02 02:00"]),
        "label": [1, 0, 0, 1],
        "s": [0.9, 0.1, 0.2, 0.8],
    })
    r = recall_at_k_per_day(df, "s", k=1)
    assert r["recall_at_k"] == 1.0
    assert r["reviewed"] == 2
