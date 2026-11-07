"""Alert prioritisation: calibrated probabilities, daily review budget, conformal bands."""
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from app.metrics import recall_at_k_per_day

EPS = 1e-6
BINS = [0, 0.001, 0.01, 0.05, 0.2, 0.5, 1.0000001]


def _logit(s):
    s = np.clip(np.asarray(s, dtype="float64"), EPS, 1 - EPS)
    return np.log(s / (1 - s))


class PlattCalibrator:
    """p = sigmoid(a * logit(score) + b), fitted on validation data.
    It never changes the order of the scores, only what the numbers mean."""

    def fit(self, scores, y):
        lr = LogisticRegression(C=1e6, max_iter=500)
        lr.fit(_logit(scores).reshape(-1, 1), np.asarray(y))
        self.a = float(lr.coef_[0, 0])
        self.b = float(lr.intercept_[0])
        if self.a <= 0:
            raise ValueError("calibration slope is not positive; scores look uninformative")
        return self

    def predict(self, scores):
        return 1 / (1 + np.exp(-(self.a * _logit(scores) + self.b)))


def reliability_table(p, y, bins=BINS):
    """For each probability range: how many rows, what the model predicted on average,
    and how often those rows were really laundering."""
    p, y = np.asarray(p), np.asarray(y)
    idx = np.digitize(p, bins[1:-1])
    rows = []
    for i in range(len(bins) - 1):
        m = idx == i
        if m.sum() == 0:
            continue
        rows.append({
            "range": f"{bins[i]:g} to {min(bins[i + 1], 1):g}",
            "rows": int(m.sum()),
            "avg predicted": float(p[m].mean()),
            "actual rate": float(y[m].mean()),
        })
    t = pd.DataFrame(rows)
    ece = float((t["rows"] * (t["avg predicted"] - t["actual rate"]).abs()).sum() / t["rows"].sum())
    return t, ece


class ConformalBands:
    """Class-conditional conformal p-values, fitted on validation data.

    p1: share of known laundering rows that scored at least this low (a tiny value
        means this alert scores lower than almost all known laundering).
    p0: share of known clean rows that scored at least this high (a tiny value
        means clean activity almost never scores this high).
    """

    def __init__(self, p_cal, y_cal):
        p_cal, y = np.asarray(p_cal), np.asarray(y_cal).astype(int)
        self.pos = np.sort(p_cal[y == 1])
        self.neg = np.sort(p_cal[y == 0])

    def p_values(self, p):
        p = np.asarray(p)
        n1, n0 = len(self.pos), len(self.neg)
        p1 = (1 + np.searchsorted(self.pos, p, side="right")) / (n1 + 1)
        p0 = (1 + n0 - np.searchsorted(self.neg, p, side="left")) / (n0 + 1)
        return p0, p1

    def bands(self, p, alpha_pos, alpha_neg):
        p0, p1 = self.p_values(p)
        pos_ok, neg_ok = p1 > alpha_pos, p0 > alpha_neg
        return np.select(
            [pos_ok & ~neg_ok, pos_ok & neg_ok, ~pos_ok & neg_ok],
            ["confident alert", "uncertain", "confident clean"],
            default="conflict",
        )


def top_k_flags(df, col, k):
    """True for the k highest-scoring rows of each day."""
    rank = df.groupby(df["ts"].dt.date)[col].rank(method="first", ascending=False)
    return rank <= k


def budget_table(df, score_cols: dict, ks):
    rows = []
    total_pos = int(df["label"].sum())
    for k in ks:
        for name, col in score_cols.items():
            r = recall_at_k_per_day(df, col, k)
            rows.append({
                "K per day": k,
                "ranking": name,
                "recall": round(r["recall_at_k"], 3),
                "real per 100 reviewed": round(r["true_per_100_reviewed"], 1),
                "max possible recall": round(min(1.0, r["reviewed"] / total_pos), 3),
            })
    return pd.DataFrame(rows)