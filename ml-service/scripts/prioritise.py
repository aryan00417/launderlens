"""Alert prioritisation on the saved scores: calibration, daily review budget,
conformal confidence bands. Also saves the alert list for the web app.

Run from ml-service/ (after scripts.train_final):   python -m scripts.prioritise HI-Small
"""
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss

from app.config import MODEL_DIR, PROCESSED_DIR
from app.prioritise import (
    ConformalBands, PlattCalibrator, budget_table, reliability_table, top_k_flags,
)

MIN_ROWS = 100_000      # same rule as before: only score the full days
KS = (25, 50, 100, 200, 300, 500)
REVIEW_K = 200          # daily review budget used for the band and alert-list sections
ALPHA_POS = 0.20        # keep 80% of known laundering inside the "could be laundering" set
ALPHA_NEG = 0.0005      # a "confident alert" must score above 99.95% of known clean rows


def main(name: str):
    sc = pd.read_parquet(PROCESSED_DIR / f"{name}_scores.parquet")
    va = sc[sc.split == "val"]
    te = sc[sc.split == "test"].copy()
    te["day"] = te["ts"].dt.date
    te = te[te.groupby("day")["ts"].transform("size") >= MIN_ROWS].copy()
    print(f"validation rows {len(va):,} ({int(va.label.sum())} laundering) | "
          f"test rows {len(te):,} on {te.day.nunique()} days ({int(te.label.sum())} laundering)")

    # 1. calibration
    cal = PlattCalibrator().fit(va.score.to_numpy(), va.label.to_numpy())
    te["p"] = cal.predict(te.score.to_numpy())
    print("\n== 1. Calibration (test days) ==")
    print(f"Brier score, raw scores {brier_score_loss(te.label, te.score):.6f} | "
          f"calibrated {brier_score_loss(te.label, te.p):.6f} (lower is better)")
    for tag, col in (("raw scores", "score"), ("calibrated", "p")):
        t, ece = reliability_table(te[col].to_numpy(), te.label.to_numpy())
        print(f"\n{tag}: calibration error {ece:.5f}")
        print(t.to_string(index=False, float_format=lambda x: f"{x:.4f}"))

    top = te[top_k_flags(te, "p", REVIEW_K)]
    ties = int(top["p"].duplicated(keep=False).sum())
    print(f"\nalerts in the top {REVIEW_K}/day that share their probability with another alert: {ties} of {len(top)}")
    per_day = top.groupby("day").agg(reviewed=("p", "size"), model_expected=("p", "sum"), actually_real=("label", "sum"))
    print(f"\nTop {REVIEW_K} alerts per day: real cases the model expected vs found")
    print(per_day.round(1).to_string())

    # 2. daily review budget
    te["rand"] = np.random.default_rng(0).random(len(te))
    print("\n== 2. Daily review budget (test days) ==")
    print(budget_table(te, {"model": "p", "largest amount": "amt_paid", "random": "rand"}, KS).to_string(index=False))

    # 3. conformal bands
    bands = ConformalBands(cal.predict(va.score.to_numpy()), va.label.to_numpy())
    p0, p1 = bands.p_values(te.p.to_numpy())
    te["band"] = bands.bands(te.p.to_numpy(), ALPHA_POS, ALPHA_NEG)
    pos, neg = te.label.to_numpy() == 1, te.label.to_numpy() == 0
    print("\n== 3. Conformal confidence bands (test days) ==")
    print(f"real laundering still inside the 'could be laundering' set: {(p1[pos] > ALPHA_POS).mean():.3f} (target {1 - ALPHA_POS:.2f})")
    print(f"clean rows that reached 'confident alert' level: {(p0[neg] <= ALPHA_NEG).mean():.5f} (target at most {ALPHA_NEG})")

    top = te[top_k_flags(te, "p", REVIEW_K)]
    g = top.groupby("band").agg(alerts=("label", "size"), real=("label", "sum"))
    g["real per 100"] = (100 * g.real / g.alerts).round(1)
    print(f"\nTop {REVIEW_K} alerts per day, split by band")
    print(g.to_string())

    # save for the web app
    out_dir = MODEL_DIR / name
    out_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "platt_a": cal.a, "platt_b": cal.b,
        "cal_pos": bands.pos.astype("float32"), "cal_neg": bands.neg.astype("float32"),
        "alpha_pos": ALPHA_POS, "alpha_neg": ALPHA_NEG,
    }, out_dir / "prioritiser.joblib")

    top = top.assign(rank=top.groupby("day")["p"].rank(method="first", ascending=False).astype(int))
    alerts = top[["edge_id", "day", "rank", "src", "dst", "amt_paid", "p", "band", "label"]]
    alerts.sort_values(["day", "rank"]).to_parquet(PROCESSED_DIR / f"{name}_alerts_test.parquet")
    print(f"\nsaved prioritiser to {out_dir} and {len(alerts):,} alerts to {name}_alerts_test.parquet")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")