"""Leak-free edge features.

Everything here only looks at transactions strictly before the current one
(cumcount / expanding), so the same function is safe on train, val and test
when called on the full time-sorted frame.
"""
import numpy as np
import pandas as pd

CAT_COLS = ["fmt", "cur_recv", "cur_paid"]
NUM_COLS = [
    "log_amt", "hour", "dow", "cross_bank", "cur_mismatch",
    "src_prior_out", "dst_prior_in", "src_prior_in", "dst_prior_out",
    "pair_prior", "src_gap_s",
]


def build_basic_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["log_amt"] = np.log1p(out["amt_paid"].clip(lower=0))
    out["hour"] = out["ts"].dt.hour
    out["dow"] = out["ts"].dt.dayofweek
    out["cross_bank"] = (out["from_bank"] != out["to_bank"]).astype(int)
    out["cur_mismatch"] = (out["cur_recv"] != out["cur_paid"]).astype(int)

    out["src_prior_out"] = out.groupby("src").cumcount()
    out["dst_prior_in"] = out.groupby("dst").cumcount()

    # Earlier incoming transactions to the sender, earlier outgoing from the receiver.
    out["src_prior_in"] = _prior_lookup(out, "src", "dst")
    out["dst_prior_out"] = _prior_lookup(out, "dst", "src")

    out["pair_prior"] = out.groupby(["src", "dst"]).cumcount()
    prev_ts = out.groupby("src")["ts"].shift(1)
    out["src_gap_s"] = (out["ts"] - prev_ts).dt.total_seconds().fillna(-1)

    for c in CAT_COLS:
        out[c] = out[c].astype("category")
    return out


def _prior_lookup(df: pd.DataFrame, node_col: str, event_col: str) -> np.ndarray:
    """For each row, how many earlier rows had this row's `node_col` value
    appearing in `event_col`. e.g. node_col='src', event_col='dst' gives the
    number of earlier incoming transactions to the current sender.
    """
    seen: dict = {}
    res = np.zeros(len(df), dtype=np.int64)
    nodes = df[node_col].to_numpy()
    events = df[event_col].to_numpy()
    for i in range(len(df)):
        res[i] = seen.get(nodes[i], 0)
        seen[events[i]] = seen.get(events[i], 0) + 1
    return res


def feature_columns() -> list[str]:
    return NUM_COLS + CAT_COLS
