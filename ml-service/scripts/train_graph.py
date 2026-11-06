"""LightGBM with basic features vs basic + graph-pattern features.

Run from ml-service/:   python -m scripts.train_graph HI-Small
The first run builds the graph features (several minutes) and caches them in
data/processed/. Delete that file if you change settings in graph_features.py.
"""
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd

from app.config import PROCESSED_DIR, RAW_DIR, SEEDS
from app.data import load_transactions, temporal_split
from app.features import build_basic_features, feature_columns
from app.graph_features import GRAPH_FEATURE_NAMES, build_graph_features
from app.metrics import best_threshold_f1, recall_at_k_per_day, recall_by_typology, summary
from sklearn.metrics import average_precision_score

MIN_ROWS = 100_000          # skip the near-empty tail days of AMLworld
N_SEEDS = 5                 # same seeds for both models so the comparison is fair
N_TREES = 300               # fixed, no early stopping (it stopped at 2 trees for some seeds and 1000 for others)
REVIEW_TOP = 1000           # for the per-typology table: review the 1000 highest alerts
DROP = ("src_gap_s", "src_prior_out")


def load_with_features(name: str) -> pd.DataFrame:
    df = load_transactions(RAW_DIR / f"{name}_Trans.csv")
    df = build_basic_features(df)

    cache = PROCESSED_DIR / f"{name}_graphfeat.parquet"
    if cache.exists():
        gf = pd.read_parquet(cache)
    else:
        print("building graph features ...")
        gf = build_graph_features(df, verbose=True)
        gf.insert(0, "edge_id", df["edge_id"].to_numpy())
        gf.to_parquet(cache)
    df = df.merge(gf, on="edge_id", how="left")

    typ = PROCESSED_DIR / f"{name}_typology.parquet"
    if typ.exists():
        df = df.merge(pd.read_parquet(typ), on="edge_id", how="left")
    else:
        df["typology"] = np.nan
    return df


def fit_scores(tr, va, te, feats, tag):
    pos_w = min((len(tr) - tr.label.sum()) / max(tr.label.sum(), 1), 50)
    sv, st, last = [], [], None
    for seed in SEEDS[:N_SEEDS]:
        m = lgb.LGBMClassifier(
            n_estimators=N_TREES, learning_rate=0.05, num_leaves=15, min_child_samples=200,
            reg_lambda=10.0, scale_pos_weight=pos_w, colsample_bytree=0.8,
            deterministic=True, force_row_wise=True, random_state=seed, verbose=-1,
        )
        m.fit(tr[feats], tr.label)
        sv.append(m.predict_proba(va[feats])[:, 1])
        st.append(m.predict_proba(te[feats])[:, 1])
        last = m
        print(f"  {tag}: seed {seed} done, val PR-AUC {average_precision_score(va.label, sv[-1]):.3f}", flush=True)
    return np.mean(sv, axis=0), np.mean(st, axis=0), last, st

def main(name: str):
    df = load_with_features(name)
    tr, va, te = temporal_split(df)
    base = [c for c in feature_columns() if c not in DROP]
    graph = base + [c for c in GRAPH_FEATURE_NAMES if c not in DROP]
    print("dropped:", DROP or "nothing")

    va["s_base"], te["s_base"], _, st_base = fit_scores(tr, va, te, base, "base")
    va["s_graph"], te["s_graph"], model, st_graph = fit_scores(tr, va, te, graph, "graph")

    full = te[te.groupby(te["ts"].dt.date)["ts"].transform("size") >= MIN_ROWS]
    print(f"\nscored on {full['ts'].dt.date.nunique()} full test days, {int(full.label.sum())} laundering edges")

    mask = te.index.isin(full.index)
    for tag, runs in (("base", st_base), ("graph", st_graph)):
        per_seed = [average_precision_score(te.label[mask], r[mask]) for r in runs]
        print(f"PR-AUC per seed, {tag}:", [round(x, 3) for x in per_seed])

    for tag, col in (("base", "s_base"), ("base + graph", "s_graph")):
        thr, _ = best_threshold_f1(va.label, va[col])
        print(f"\n[{tag}]", summary(full.label.to_numpy(), full[col].to_numpy(), thr))
        for k in (100, 300, 1000):
            r = recall_at_k_per_day(full, col, k)
            print(f"  K={k}/day  recall {r['recall_at_k']:.3f}  true per 100 reviewed {r['true_per_100_reviewed']:.1f}")

    if full["typology"].notna().any():
        rows = []
        for col in ("s_base", "s_graph"):
            thr = np.sort(full[col].to_numpy())[-REVIEW_TOP]
            t = recall_by_typology(full, col, thr)[["typology", "recall", "n"]]
            rows.append(t.rename(columns={"recall": col.replace("s_", "recall_")}))
        out = rows[0].merge(rows[1][["typology", "recall_graph"]], on="typology")
        print(f"\nrecall by typology when the top {REVIEW_TOP} alerts are reviewed (full days)")
        print(out.to_string(index=False, float_format=lambda x: f"{x:.3f}"))

    pos, neg = full[full.label == 1], full[full.label == 0]
    print(f"\nedges closing a cycle: laundering {(pos.cycle_len > 0).mean():.3f} | clean {(neg.cycle_len > 0).mean():.3f}")
    print("share closing a cycle, by typology")
    print(pos.groupby("typology")["cycle_len"].apply(lambda x: (x > 0).mean()).round(3).to_string())

    imp = pd.Series(model.booster_.feature_importance(importance_type="gain"), index=graph)
    print("\ntop features by gain (graph model)")
    print((imp / imp.sum()).sort_values(ascending=False).head(10).round(3).to_string())


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")