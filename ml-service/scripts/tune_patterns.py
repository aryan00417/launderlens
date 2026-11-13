"""Choose the pattern matcher's limits from TRAINING-period data only.

For each setting we measure two things:
  recall  how many of the dataset's own pattern edges (from the Patterns file) the rule recognises
  false   how many ordinary transactions (random, label 0) the rule also fires on
A good setting has high recall and a low false rate. Test days are never touched.

Run from ml-service/:   python -m scripts.tune_patterns HI-Small
"""
import sys
import time

import numpy as np
import pandas as pd

import app.evidence as E
from app.config import RAW_DIR, TRAIN_FRAC
from app.data import load_transactions
from scripts.pattern_stats import read_attempts

N_BG = 1500
H = 3600


def positives(df, attempts, n_train):
    lab = df.iloc[:n_train]
    lab = lab[lab.label == 1][["edge_id", "ts", "src", "dst", "amt_recv"]]
    rows = pd.concat([d.assign(typology=t) for t, d in attempts])
    return rows.merge(lab, on=["ts", "src", "dst", "amt_recv"], how="inner").drop_duplicates("edge_id")


def amount_ratios(attempts, cutoff):
    """paid(next) / received(previous) along each attempt: do patterns pass money on unchanged?"""
    out = {}
    for typ, d in attempts:
        d = d.sort_values("ts").reset_index(drop=True)
        if d.ts.max() >= cutoff:
            continue
        for j in range(len(d)):
            prev = d[(d.index < j) & (d.dst == d.src[j])]
            if len(prev) and prev.amt_recv.iloc[-1] > 0:
                out.setdefault(typ, []).append(d.amt_paid[j] / prev.amt_recv.iloc[-1])
    return out


def fires(g, edges, fn, name=None):
    hits = 0
    for e in edges:
        r = fn(g, int(e))
        hits += bool(r) and (name is None or r["pattern"] == name)
    return hits / max(len(edges), 1)


def main(name):
    t0 = time.time()
    df = load_transactions(RAW_DIR / f"{name}_Trans.csv")
    n_train = int(len(df) * TRAIN_FRAC)
    g = E.TxGraph(df)
    attempts = read_attempts(RAW_DIR / f"{name}_Patterns.txt")
    cutoff = df.ts.iloc[n_train]
    pos = positives(df, attempts, n_train)
    print(f"{len(pos)} training-period pattern edges found; counts by typology:")
    print(pos.typology.value_counts().to_string(), "\n")

    rng = np.random.default_rng(0)
    pool = df.index[int(n_train * 0.5):n_train]
    bg = rng.choice(pool[df.label.to_numpy()[pool] == 0], N_BG, replace=False)

    print("== do patterns pass money on unchanged? paid(next) / received(previous) ==")
    r = amount_ratios(attempts, cutoff)
    print(pd.DataFrame({k: pd.Series(v).quantile([.05, .25, .5, .75, .95]) for k, v in r.items()}).round(2).T.rename(
        columns={.05: "p5", .25: "p25", .5: "median", .75: "p75", .95: "p95"}).to_string(), "\n")

    print("== CYCLE rule: window either side of the alert, longest cycle, amount tolerance ==")
    cyc = pos[pos.typology == "CYCLE"].edge_id.to_numpy()
    rows = []
    for w in (24, 48, 96):
        for ml in (6, 10):
            for tol in (None, (0.8, 1.25), (0.5, 2.0)):
                E.WIN_BEFORE = E.WIN_AFTER = w * H
                E.MAX_CYCLE, E.AMT_TOL = ml, tol
                rows.append({"window_h": w, "max_len": ml, "amount_tol": str(tol),
                             "recall": round(fires(g, cyc, E.find_cycle), 3), "false": round(fires(g, bg, E.find_cycle), 3)})
    print(pd.DataFrame(rows).to_string(index=False), f"\n({len(cyc)} cycle edges, {N_BG} ordinary edges)\n")

    print("== FAN rules: window either side, accounts needed ==")
    rows = []
    for w in (24, 48, 96):
        for k in (3, 4, 5, 8):
            E.FAN_WIN, E.FAN_MIN_OUT, E.FAN_MIN_IN = w * H, k, k
            row = {"window_h": w, "min_accounts": k}
            for typ, rule in (("FAN-OUT", "fan_out"), ("FAN-IN", "fan_in")):
                ids = pos[pos.typology == typ].edge_id.to_numpy()
                row[f"{rule} recall"] = round(fires(g, ids, E.find_fan, rule), 3)
                row[f"{rule} false"] = round(fires(g, bg, E.find_fan, rule), 3)
            rows.append(row)
    print(pd.DataFrame(rows).to_string(index=False))
    print(f"\ndone in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
