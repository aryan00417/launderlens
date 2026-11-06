"""Loading and splitting IBM AMLworld transaction files.

Expected raw file: HI-Small_Trans.csv (or LI-Small_Trans.csv etc.) with columns
Timestamp, From Bank, Account, To Bank, Account.1, Amount Received,
Receiving Currency, Amount Paid, Payment Currency, Payment Format, Is Laundering
"""
from pathlib import Path

import pandas as pd

from .config import TRAIN_FRAC, VAL_FRAC

RENAME = {
    "Timestamp": "ts",
    "From Bank": "from_bank",
    "Account": "from_acc",
    "To Bank": "to_bank",
    "Account.1": "to_acc",
    "Amount Received": "amt_recv",
    "Receiving Currency": "cur_recv",
    "Amount Paid": "amt_paid",
    "Payment Currency": "cur_paid",
    "Payment Format": "fmt",
    "Is Laundering": "label",
}


def load_transactions(path: str | Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df = df.rename(columns=RENAME)
    df["ts"] = pd.to_datetime(df["ts"])
    df = df.sort_values("ts", kind="stable").reset_index(drop=True)
    df["edge_id"] = df.index
    # Account ids repeat across banks, so prefix the bank to make nodes unique.
    df["src"] = df["from_bank"].astype(str) + "_" + df["from_acc"].astype(str)
    df["dst"] = df["to_bank"].astype(str) + "_" + df["to_acc"].astype(str)
    df["label"] = df["label"].astype(int)
    return df


def temporal_split(df: pd.DataFrame, train_frac: float = TRAIN_FRAC, val_frac: float = VAL_FRAC):
    """Split by row order of a time-sorted frame. Returns (train, val, test)."""
    n = len(df)
    i = int(n * train_frac)
    j = int(n * (train_frac + val_frac))
    return df.iloc[:i].copy(), df.iloc[i:j].copy(), df.iloc[j:].copy()
