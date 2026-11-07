"""Train the final detector with the frozen settings, save the models, and save
scores for the validation and test rows (used by scripts/prioritise.py).

Run from ml-service/:   python -m scripts.train_final HI-Small
"""
import json
import sys

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

from app.config import MODEL_DIR, PROCESSED_DIR, SEEDS
from app.data import temporal_split
from app.features import feature_columns
from app.graph_features import GRAPH_FEATURE_NAMES
from scripts.train_graph import load_with_features

FINAL_DROP = ("src_gap_s", "src_prior_out")
N_TREES = 300


def main(name: str):
    df = load_with_features(name)
    tr, va, te = temporal_split(df)
    feats = [c for c in feature_columns() + GRAPH_FEATURE_NAMES if c not in FINAL_DROP]

    out_dir = MODEL_DIR / name
    out_dir.mkdir(parents=True, exist_ok=True)
    pos_w = min((len(tr) - tr.label.sum()) / max(tr.label.sum(), 1), 50)

    sv, st = [], []
    for seed in SEEDS:
        m = lgb.LGBMClassifier(
            n_estimators=N_TREES, learning_rate=0.05, num_leaves=15, min_child_samples=200,
            reg_lambda=10.0, scale_pos_weight=pos_w, colsample_bytree=0.8,
            deterministic=True, force_row_wise=True, random_state=seed, verbose=-1,
        )
        m.fit(tr[feats], tr.label)
        joblib.dump(m, out_dir / f"lgbm_seed{seed}.joblib")
        sv.append(m.predict_proba(va[feats])[:, 1])
        st.append(m.predict_proba(te[feats])[:, 1])
        print(f"seed {seed} trained and saved", flush=True)

    info = {"features": feats, "seeds": SEEDS, "n_trees": N_TREES, "dropped": list(FINAL_DROP)}
    (out_dir / "model_info.json").write_text(json.dumps(info, indent=2))

    va = va.assign(split="val", score=np.mean(sv, axis=0))
    te = te.assign(split="test", score=np.mean(st, axis=0))
    keep = ["edge_id", "split", "ts", "label", "typology", "src", "dst", "amt_paid", "score"]
    out = pd.concat([va[keep], te[keep]], ignore_index=True)
    out.to_parquet(PROCESSED_DIR / f"{name}_scores.parquet")
    print(f"saved models to {out_dir} and scores to {name}_scores.parquet")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")