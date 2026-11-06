"""Checks rows per day and the unlabelled laundering edges.
Run from ml-service/:  python -m scripts.diagnose HI-Small
"""
import sys

import pandas as pd

from app.config import PROCESSED_DIR, RAW_DIR
from app.data import load_transactions
from scripts.parse_patterns import parse


def main(name: str):
    df = load_transactions(RAW_DIR / f"{name}_Trans.csv")
    df["day"] = df["ts"].dt.date

    print("rows and laundering edges per day")
    print(df.groupby("day").agg(rows=("label", "size"), laundering=("label", "sum")).to_string())

    typ = pd.read_parquet(PROCESSED_DIR / f"{name}_typology.parquet")
    df = df.merge(typ, on="edge_id", how="left")
    pats = parse(RAW_DIR / f"{name}_Patterns.txt")
    print("\nrows in patterns file:", len(pats), "| laundering edges in csv:", int(df.label.sum()))

    miss = df[(df.label == 1) & df.typology.isna()]
    print("unlabelled laundering edges:", len(miss))
    print(miss[["ts", "src", "dst", "amt_recv", "fmt"]].head(10).to_string())

    print("\nunlabelled, by payment format")
    print(miss.fmt.value_counts())
    print("\nlabelled, by payment format")
    print(df[(df.label == 1) & df.typology.notna()].fmt.value_counts())

    # Does the sender/receiver pair appear in the patterns file at all?
    pats["src"] = pats.from_bank.astype(int).astype(str) + "_" + pats.from_acc.astype(str)
    pats["dst"] = pats.to_bank.astype(int).astype(str) + "_" + pats.to_acc.astype(str)
    pairs = set(zip(pats.src, pats.dst))
    in_pairs = sum((s, d) in pairs for s, d in zip(miss.src, miss.dst))
    print(f"\nunlabelled edges whose sender/receiver pair is in the patterns file: {in_pairs} of {len(miss)}")

    print("\nunlabelled laundering per day")
    print(miss.groupby("day").size())


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "HI-Small")