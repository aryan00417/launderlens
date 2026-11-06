"""Baseline 1 and 2: logistic regression and LightGBM on basic edge features.

Usage (from ml-service/):
  python -m scripts.train_baseline HI-Small
"""
import sys

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from app.config import PROCESSED_DIR, RAW_DIR, SEEDS
from app.data import load_transactions, temporal_split
from app.features import CAT_COLS, NUM_COLS, build_basic_features, feature_columns
from app.metrics import best_threshold_f1, recall_at_k_per_day, recall_by_typology, summary


def main(name: str):
    df = load_transactions(RAW_DIR / f"{name}_Trans.csv")
    df = build_basic_features(df)

    typ_path = PROCESSED_DIR / f"{name}_typology.parquet"
    if typ_path.exists():
        df = df.merge(pd.read_parquet(typ_path), on="edge_id", how="left")
    else:
        df["typology"] = np.nan

    tr, va, te = temporal_split(df)
    print(f"train {len(tr):,}  val {len(va):,}  test {len(te):,}")
    print(f"illicit share: train {tr.label.mean():.4%}  test {te.label.mean():.4%}")

    feats = feature_columns()

    # --- logistic regression (numeric features only) ---
    sc = StandardScaler().fit(tr[NUM_COLS])
    lr = LogisticRegression(max_iter=300, class_weight="balanced")
    lr.fit(sc.transform(tr[NUM_COLS]), tr.label)
    va["s_lr"] = lr.predict_proba(sc.transform(va[NUM_COLS]))[:, 1]
    te["s_lr"] = lr.predict_proba(sc.transform(te[NUM_COLS]))[:, 1]
    report("logreg", va, te, "s_lr")

    # --- LightGBM, several seeds ---
    pos_w = (len(tr) - tr.label.sum()) / max(tr.label.sum(), 1)
    te_scores, va_scores = [], []
    for seed in SEEDS:
        m = lgb.LGBMClassifier(
            n_estimators=400, learning_rate=0.05, num_leaves=63,
            scale_pos_weight=min(pos_w, 50), subsample=0.8, colsample_bytree=0.8,
            random_state=seed, verbose=-1,
        )
        m.fit(tr[feats], tr.label)
        va_scores.append(m.predict_proba(va[feats])[:, 1])
        te_scores.append(m.predict_proba(te[feats])[:, 1])
    va["s_lgbm"] = np.mean(va_scores, axis=0)
    te["s_lgbm"] = np.mean(te_scores, axis=0)
    report("lightgbm", va, te, "s_lgbm")

    if te["typology"].notna().any():
        thr, _ = best_threshold_f1(va.label, va.s_lgbm)
        print("\nrecall by typology (lightgbm, test)")
        print(recall_by_typology(te, "s_lgbm", thr).to_string(index=False))


def report(tag: str, va, te, col: str):
    thr, _ = best_threshold_f1(va.label, va[col])  # threshold chosen on val only
    print(f"\n[{tag}] threshold {thr:.4f}")
    print("all test rows:", summary(te.label.to_numpy(), te[col].to_numpy(), thr))
    full = te[te.groupby(te["ts"].dt.date)["ts"].transform("size") >= 100_000]
    print("full days only:", summary(full.label.to_numpy(), full[col].to_numpy(), thr))
    for k in (100, 300, 1000):
        print(recall_at_k_per_day(te, col, k, min_rows=100_000))
        print(recall_at_k_per_day(te, col, k))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
