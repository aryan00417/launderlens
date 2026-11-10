"""Group alerts into candidate cases.

Alerts on the same day that share an account (directly or through a chain of
shared accounts) belong to the same group. One laundering chain produces many
alerts, and an investigator should open it as one case.
"""
import pandas as pd


def group_alerts(df: pd.DataFrame) -> pd.Series:
    """Needs columns day, src, dst, p. Returns labels like '2022-09-09-G01',
    numbered per day from the group with the highest probability."""
    labels = pd.Series(index=df.index, dtype=object)
    for day, g in df.groupby("day"):
        parent: dict = {}

        def find(x):
            while parent.setdefault(x, x) != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for s, d in zip(g["src"], g["dst"]):
            a, b = find(s), find(d)
            if a != b:
                parent[a] = b

        roots = pd.Series([find(s) for s in g["src"]], index=g.index)
        order = g["p"].groupby(roots).max().sort_values(ascending=False)
        names = {r: f"{day}-G{i + 1:02d}" for i, r in enumerate(order.index)}
        labels.loc[g.index] = roots.map(names)
    return labels


def group_summary(df: pd.DataFrame) -> dict:
    """Needs columns group and label (label is only known in evaluation)."""
    sizes = df.groupby("group").size()
    real = df.groupby("group")["label"].max()
    return {
        "groups": int(len(sizes)),
        "groups_with_real": int((real > 0).sum()),
        "median_size": float(sizes.median()),
        "max_size": int(sizes.max()),
        "singletons": int((sizes == 1).sum()),
    }
