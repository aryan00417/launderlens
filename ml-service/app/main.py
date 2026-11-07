"""LaunderLens ML service: serves the daily alert queue produced by scripts.prioritise."""
import re
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException, Query

from .config import PROCESSED_DIR

app = FastAPI(title="LaunderLens ML service", version="0.2.0")
NAME_OK = re.compile(r"^[A-Za-z0-9_-]+$")


@lru_cache(maxsize=4)
def _load_alerts(dataset: str) -> pd.DataFrame:
    df = pd.read_parquet(PROCESSED_DIR / f"{dataset}_alerts_test.parquet")
    df["day"] = df["day"].astype(str)
    return df


def _alerts(dataset: str) -> pd.DataFrame:
    if not NAME_OK.match(dataset):
        raise HTTPException(400, "bad dataset name")
    try:
        return _load_alerts(dataset)
    except FileNotFoundError:
        raise HTTPException(404, f"no alerts for {dataset}; run scripts.prioritise first")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/days")
def days(dataset: str = "HI-Small"):
    """Which days have an alert queue, and how many alerts per confidence band."""
    df = _alerts(dataset)
    g = df.groupby(["day", "band"]).size().unstack(fill_value=0)
    out = [
        {"day": d, "alerts": int(g.loc[d].sum()), "bands": {b: int(v) for b, v in g.loc[d].items()}}
        for d in g.index
    ]
    return {"dataset": dataset, "days": out}


@app.get("/alerts")
def alerts(
    dataset: str = "HI-Small",
    day: str | None = None,
    band: str | None = None,
    limit: int = Query(100, ge=1, le=1000),
    debug: bool = False,
):
    """The day's alert queue, highest probability first. `debug=true` also returns the
    ground-truth label, which a real bank would not have."""
    df = _alerts(dataset)
    if day:
        df = df[df["day"] == day]
    if band:
        df = df[df["band"] == band]
    df = df.sort_values(["day", "rank"]).head(limit)
    cols = ["edge_id", "day", "rank", "src", "dst", "amt_paid", "p", "band"]
    if debug:
        cols.append("label")
    return {"dataset": dataset, "count": len(df), "alerts": df[cols].to_dict(orient="records")}


@app.post("/score")
def score(payload: dict):
    """Placeholder. Scoring new uploads needs the live graph features (ingestion module)."""
    return {"scores": [], "note": "not implemented yet"}