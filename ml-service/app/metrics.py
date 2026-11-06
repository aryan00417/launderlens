import numpy as np
import pandas as pd
from sklearn.metrics import average_precision_score, f1_score, precision_recall_curve


def best_threshold_f1(y_true, scores) -> tuple[float, float]:
    """Pick the threshold on VALIDATION data that maximises minority-class F1."""
    p, r, t = precision_recall_curve(y_true, scores)
    f = 2 * p * r / np.clip(p + r, 1e-12, None)
    k = int(np.nanargmax(f[:-1])) if len(t) else 0
    return float(t[k]), float(f[k])


def summary(y_true, scores, threshold: float) -> dict:
    pred = (scores >= threshold).astype(int)
    return {
        "pr_auc": float(average_precision_score(y_true, scores)),
        "f1_minority": float(f1_score(y_true, pred, pos_label=1)),
        "positives": int(np.sum(y_true)),
        "flagged": int(pred.sum()),
    }


def recall_at_k_per_day(df: pd.DataFrame, score_col: str, k: int, min_rows: int = 0) -> dict:
    """Investigator-budget metric (the N2 claim).

    Each day the investigator reviews the top-k alerts by score. Days with fewer
    than `min_rows` transactions are skipped (the AMLworld tail days are almost
    all laundering and would inflate the metric). Recall is measured against the
    laundering edges on the days that were scored.
    """
    d = df.copy()
    d["day"] = d["ts"].dt.date
    caught = reviewed = days_used = pos_in_scope = 0
    for _, g in d.groupby("day"):
        if len(g) < min_rows:
            continue
        days_used += 1
        pos_in_scope += int(g["label"].sum())
        top = g.nlargest(k, score_col)
        caught += int(top["label"].sum())
        reviewed += len(top)
    return {
        "k": k,
        "days_scored": days_used,
        "recall_at_k": caught / pos_in_scope if pos_in_scope else 0.0,
        "true_per_100_reviewed": 100 * caught / reviewed if reviewed else 0.0,
        "reviewed": reviewed,
        "positives_in_scope": pos_in_scope,
        "positives_total": int(d["label"].sum()),
    }


def recall_by_typology(df: pd.DataFrame, score_col: str, threshold: float) -> pd.DataFrame:
    """Needs a `typology` column (from scripts/parse_patterns.py). Rows with
    label 1 but no typology are grouped as 'UNLABELLED'."""
    pos = df[df["label"] == 1].copy()
    pos["typology"] = pos["typology"].fillna("UNLABELLED")
    pos["hit"] = (pos[score_col] >= threshold).astype(int)
    return pos.groupby("typology")["hit"].agg(recall="mean", n="count").reset_index()
