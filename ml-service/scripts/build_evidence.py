"""Build the evidence subgraph for every alert in the saved alert list, and check how well
the pattern matcher agrees with the dataset's own typology labels.

Run from ml-service/ (after scripts.prioritise):   python -m scripts.build_evidence HI-Small
"""
import json
import sys
import time

import numpy as np
import pandas as pd

from app.config import PROCESSED_DIR, RAW_DIR
from app.data import load_transactions
from app.evidence import TxGraph, explain

# Which of our rules should fire for which AMLworld typology. STACK, BIPARTITE and RANDOM have no rule.
EXPECTED = {"CYCLE": "cycle", "FAN-OUT": "fan_out", "FAN-IN": "fan_in",
            "GATHER-SCATTER": "gather_scatter", "SCATTER-GATHER": "scatter_gather"}


def main(name: str):
    t0 = time.time()
    alerts = pd.read_parquet(PROCESSED_DIR / f"{name}_alerts_test.parquet")
    df = load_transactions(RAW_DIR / f"{name}_Trans.csv")
    g = TxGraph(df)
    print(f"graph built in {time.time() - t0:.0f}s ({len(df):,} transactions)")

    ev = {}
    for i, eid in enumerate(alerts["edge_id"], 1):
        ev[int(eid)] = explain(g, int(eid))
        if i % 200 == 0:
            print(f"  {i}/{len(alerts)} alerts explained", flush=True)
    (PROCESSED_DIR / f"{name}_evidence.json").write_text(json.dumps(ev))
    print(f"saved {len(ev)} explanations to {name}_evidence.json ({time.time() - t0:.0f}s)")

    a = alerts[["edge_id", "label"]].copy()
    a["pattern"] = [ev[int(e)]["pattern"] for e in a.edge_id]
    a["edges"] = [ev[int(e)]["size"]["edges"] for e in a.edge_id]
    print("\n== Evidence summary ==")
    print("alerts with a pattern found, by whether the alert was real:")
    print(a.assign(found=a.pattern != "none").groupby("label")["found"].mean().round(3).to_string())
    print(f"median evidence size: {a.edges.median():.0f} transactions (largest {a.edges.max()})")
    print("\npattern counts")
    print(a.pattern.value_counts().to_string())

    typ = PROCESSED_DIR / f"{name}_typology.parquet"
    if typ.exists():
        t = pd.read_parquet(typ)
        r = a[a.label == 1].merge(t, on="edge_id", how="left")
        r["typology"] = r["typology"].fillna("UNLABELLED")
        print("\n== Agreement with the dataset's typology labels (real alerts only) ==")
        print(pd.crosstab(r.typology, r.pattern).to_string())
        rows = []
        for typ_name, rule in EXPECTED.items():
            sub = r[r.typology == typ_name]
            if len(sub):
                rows.append({"typology": typ_name, "alerts": len(sub), "expected rule fired": round((sub.pattern == rule).mean(), 3),
                             "any pattern fired": round((sub.pattern != "none").mean(), 3)})
        print("\nhow often the matching rule fired")
        print(pd.DataFrame(rows).to_string(index=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
