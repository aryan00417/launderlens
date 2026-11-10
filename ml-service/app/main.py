"""LaunderLens ML service: serves the daily alert queue produced by scripts.prioritise."""
import json
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


@lru_cache(maxsize=2)
def _load_evidence(dataset: str) -> dict:
    return json.loads((PROCESSED_DIR / f"{dataset}_evidence.json").read_text())


def _evidence(dataset: str) -> dict:
    if not NAME_OK.match(dataset):
        raise HTTPException(400, "bad dataset name")
    try:
        return _load_evidence(dataset)
    except FileNotFoundError:
        return {}


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
def days(dataset: str = "HI-Small", k: int | None = Query(None, ge=1)):
    """Which days have an alert queue, and how many alerts per confidence band.
    `k` is the daily review budget: only alerts ranked 1..k count."""
    df = _alerts(dataset)
    if k:
        df = df[df["rank"] <= k]
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
    group: str | None = None,
    k: int | None = Query(None, ge=1),
    limit: int = Query(100, ge=1, le=1000),
    debug: bool = False,
):
    """The day's alert queue, highest probability first. `k` is the daily review budget.
    `debug=true` also returns the ground-truth label, which a real bank would not have."""
    df = _alerts(dataset)
    if k:
        df = df[df["rank"] <= k]
    if "group" in df.columns:
        df = df.assign(group_size=df.groupby("group")["edge_id"].transform("size"))
    if day:
        df = df[df["day"] == day]
    if band:
        df = df[df["band"] == band]
    if group:
        df = df[df["group"] == group] if "group" in df.columns else df.iloc[0:0]
    df = df.sort_values(["day", "rank"]).head(limit)
    ev = _evidence(dataset)
    if ev:
        df = df.assign(pattern=[ev.get(str(i), {}).get("label") for i in df["edge_id"]])
    cols = ["edge_id", "day", "rank", "src", "dst", "amt_paid", "p", "band"]
    cols += [c for c in ("ts", "group", "group_size", "pattern") if c in df.columns]
    if debug:
        cols.append("label")
    records = df[cols].to_dict(orient="records")
    for r in records:
        if "pattern" in r and not isinstance(r["pattern"], str):
            r["pattern"] = None          # alert without an explanation yet; keep the JSON valid
    return {"dataset": dataset, "count": len(df), "alerts": records}


@app.get("/evidence")
def evidence(dataset: str = "HI-Small", edge_ids: str = Query(..., description="comma separated edge ids")):
    """Evidence subgraphs (pattern, plain-language reason, transactions) for up to 500 alerts."""
    ids = [x.strip() for x in edge_ids.split(",") if x.strip()][:500]
    if not all(x.isdigit() for x in ids):
        raise HTTPException(400, "edge_ids must be numbers")
    ev = _evidence(dataset)
    return {"dataset": dataset, "evidence": {i: ev[i] for i in ids if i in ev}}


@app.post("/score")
def score(payload: dict):
    """Placeholder. Scoring new uploads needs the live graph features (ingestion module)."""
    return {"scores": [], "note": "not implemented yet"}
