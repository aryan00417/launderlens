"""Attach a typology label to every laundering edge using the AMLworld
*_Patterns.txt file, and save data/processed/<name>_typology.parquet.

Usage:
  python -m scripts.parse_patterns HI-Small

The patterns file has blocks like
  BEGIN LAUNDERING ATTEMPT - FAN-OUT
  <csv transaction rows>
  END LAUNDERING ATTEMPT - FAN-OUT
Check the first lines of your file; if the format differs, adjust parse().
"""
import sys

import pandas as pd

from app.config import PROCESSED_DIR, RAW_DIR
from app.data import load_transactions

KEY = ["Timestamp", "From Bank", "Account", "To Bank", "Account.1", "Amount Received"]


def parse(path) -> pd.DataFrame:
    rows, typ = [], None
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("BEGIN LAUNDERING ATTEMPT"):
                typ = line.split(" - ", 1)[1].split(":")[0].strip()
            elif line.startswith("END LAUNDERING ATTEMPT"):
                typ = None
            elif typ and line:
                parts = line.split(",")
                rows.append((parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], typ))
    return pd.DataFrame(rows, columns=["ts_raw", "from_bank", "from_acc", "to_bank", "to_acc", "amt", "typology"])


def main(name: str):
    trans = load_transactions(RAW_DIR / f"{name}_Trans.csv")
    pats = parse(RAW_DIR / f"{name}_Patterns.txt")
    pats["ts"] = pd.to_datetime(pats["ts_raw"])
    pats["amt_recv"] = pats["amt"].astype(float)
    for c in ["from_bank", "to_bank"]:
        pats[c] = pats[c].astype(trans[c].dtype)
    pats["from_acc"] = pats["from_acc"].astype(str)
    pats["to_acc"] = pats["to_acc"].astype(str)
    t = trans.copy()
    t["from_acc"] = t["from_acc"].astype(str)
    t["to_acc"] = t["to_acc"].astype(str)
    keys = ["ts", "from_bank", "from_acc", "to_bank", "to_acc", "amt_recv"]
    pats = pats.drop_duplicates(keys)[keys + ["typology"]]
    merged = t.merge(pats, on=keys, how="left")
    out = merged[["edge_id", "typology"]]
    out.to_parquet(PROCESSED_DIR / f"{name}_typology.parquet")
    n_lab = merged.loc[merged["label"] == 1, "typology"].notna().mean()
    print(f"saved. {n_lab:.1%} of laundering edges got a typology")
    print(merged.loc[merged["label"] == 1, "typology"].value_counts(dropna=False))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")
