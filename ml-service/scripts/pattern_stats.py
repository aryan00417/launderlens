"""Measure the laundering patterns the AMLworld generator actually created, using only attempts
that finished in the training period. The pattern matcher's limits (cycle length, time window,
fan sizes) should come from these numbers, not from guesses, and never from the test days.

Run from ml-service/:   python -m scripts.pattern_stats HI-Small
"""
import sys

import numpy as np
import pandas as pd

from app.config import RAW_DIR, TRAIN_FRAC


def read_attempts(path):
    attempts, name, rows = [], None, []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("BEGIN LAUNDERING ATTEMPT"):
                name, rows = line.split(" - ", 1)[1].split(":")[0].strip(), []
            elif line.startswith("END LAUNDERING ATTEMPT"):
                if rows:
                    attempts.append((name, pd.DataFrame(rows, columns=["ts", "src", "dst", "amt_recv", "amt_paid"])))
                name = None
            elif name and line:
                p = line.split(",")
                rows.append((pd.Timestamp(p[0]), f"{int(p[1])}_{p[2]}", f"{int(p[3])}_{p[4]}", float(p[5]), float(p[7])))
    return attempts


def measure(typ, df):
    out_deg = df.groupby("src")["dst"].nunique()
    in_deg = df.groupby("dst")["src"].nunique()
    both = (out_deg.reindex(in_deg.index).fillna(0) * in_deg)
    gaps = df["ts"].sort_values().diff().dropna().dt.total_seconds() / 3600
    return {
        "typology": typ,
        "edges": len(df),
        "accounts": len(set(df.src) | set(df.dst)),
        "span_h": (df.ts.max() - df.ts.min()).total_seconds() / 3600,
        "max_gap_h": gaps.max() if len(gaps) else 0.0,
        "max_out": out_deg.max(),
        "max_in": in_deg.max(),
        "hub_in": in_deg[both.idxmax()] if len(both) else 0,
        "hub_out": out_deg.get(both.idxmax(), 0) if len(both) else 0,
    }


def main(name):
    ts = pd.read_csv(RAW_DIR / f"{name}_Trans.csv", usecols=["Timestamp"])["Timestamp"]
    cutoff = pd.to_datetime(ts).sort_values().iloc[int(len(ts) * TRAIN_FRAC)]
    att = read_attempts(RAW_DIR / f"{name}_Patterns.txt")
    rows = [measure(t, d) for t, d in att if d.ts.max() < cutoff]
    m = pd.DataFrame(rows)
    print(f"training cutoff {cutoff} | {len(m)} of {len(att)} attempts finished before it\n")
    q = [0.05, 0.5, 0.95, 1.0]
    for typ, g in m.groupby("typology"):
        print(f"== {typ} ({len(g)} attempts) ==")
        cols = ["edges", "accounts", "span_h", "max_gap_h", "max_out", "max_in", "hub_in", "hub_out"]
        print(g[cols].quantile(q).round(1).rename(index={0.05: "p5", 0.5: "median", 0.95: "p95", 1.0: "max"}).to_string())
        print()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
