"""Graph-pattern features, computed in one pass over time-sorted transactions.

Every feature for edge i only uses edges that came before i, so there is no
leakage and the same function works on train, val and test together.

Per edge u -> v we compute:
  * for each window in WINDOWS_H, for both u (src) and v (dst), how many
    transactions and how many distinct counterparties they had going out and
    coming in. Fan-out/fan-in shows as a big distinct count on one side;
    gather-scatter shows as big numbers on both in and out of the same account.
  * src_since_last_in_s and fwd_ratio: how fast u passes on money it received,
    and whether the amount sent is close to the amount last received.
  * cycle_len: length of the shortest time-ordered cycle this edge closes
    (u -> v, then v -> ... -> u earlier), 0 if none.
"""
import time
from collections import deque

import numpy as np
import pandas as pd

WINDOWS_H = (3, 24)
CYCLE_WINDOW_H = 72
CYCLE_MAX_LEN = 5      # longest cycle searched, counting the closing edge
NEIGHBOUR_CAP = 30     # newest neighbours remembered per account for cycle search
SEARCH_BUDGET = 80     # max accounts visited per edge during cycle search

GRAPH_FEATURE_NAMES = (
    [
        f"{who}_{way}_{kind}_{w}h"
        for w in WINDOWS_H
        for who in ("src", "dst")
        for way in ("out", "in")
        for kind in ("n", "d")
    ]
    + ["src_since_last_in_s", "fwd_ratio", "cycle_len"]
)


class _Side:
    """One direction (out or in) and one window. Per account it keeps the
    events still inside the window plus running counts, so reading the number of
    transactions and distinct counterparties is cheap."""

    __slots__ = ("w", "dq", "cnt")

    def __init__(self, window_s: int):
        self.w = window_s
        self.dq: dict = {}
        self.cnt: dict = {}

    def read(self, node, t):
        dq = self.dq.get(node)
        if not dq:
            return 0, 0
        cutoff = t - self.w
        if dq[0][0] < cutoff:
            cnt = self.cnt[node]
            while dq and dq[0][0] < cutoff:
                _, other = dq.popleft()
                c = cnt[other] - 1
                if c:
                    cnt[other] = c
                else:
                    del cnt[other]
        return len(dq), len(self.cnt[node])

    def add(self, node, t, other):
        dq = self.dq.get(node)
        if dq is None:
            dq = self.dq[node] = deque()
            self.cnt[node] = {}
        dq.append((t, other))
        c = self.cnt[node]
        c[other] = c.get(other, 0) + 1


def _cycle_len(u, v, t, last_out) -> int:
    """Shortest time-ordered path v -> ... -> u among earlier edges inside the
    cycle window. Returns the cycle length including the current edge, or 0."""
    if u == v:
        return 0
    frontier = [(v, t - CYCLE_WINDOW_H * 3600)]  # (account, earliest time the next hop may have)
    seen = {v}
    budget = SEARCH_BUDGET
    for hops in range(1, CYCLE_MAX_LEN):
        nxt = []
        for node, t_ok in frontier:
            nb = last_out.get(node)
            if not nb:
                continue
            for y, ty in reversed(nb.items()):  # newest first
                if ty < t_ok:
                    break
                if y == u:
                    return hops + 1
                if y not in seen:
                    seen.add(y)
                    nxt.append((y, ty))
                    budget -= 1
                    if budget <= 0:
                        return 0
        if not nxt:
            return 0
        frontier = nxt
    return 0


def build_graph_features(df: pd.DataFrame, verbose: bool = False) -> pd.DataFrame:
    """df must be sorted by time and have columns src, dst, ts, amt_paid, amt_recv.
    Returns a frame with GRAPH_FEATURE_NAMES as columns and the same index as df."""
    n = len(df)
    codes, _ = pd.factorize(pd.concat([df["src"], df["dst"]], ignore_index=True))
    s = codes[:n].tolist()
    d = codes[n:].tolist()
    t = df["ts"].astype("datetime64[s]").astype("int64").tolist()  # seconds, whatever unit pandas uses
    paid = df["amt_paid"].to_numpy(dtype="float64").tolist()
    recv = df["amt_recv"].to_numpy(dtype="float64").tolist()

    sides = [(_Side(w * 3600), _Side(w * 3600)) for w in WINDOWS_H]  # (out, in)
    last_in: dict = {}   # account -> (time, amount received)
    last_out: dict = {}  # account -> {counterparty: time of last transfer}, newest last

    out = np.empty((n, len(GRAPH_FEATURE_NAMES)), dtype=np.float32)
    t0 = time.time()
    for i in range(n):
        u, v, ti = s[i], d[i], t[i]
        row = []
        for o_side, i_side in sides:
            row += o_side.read(u, ti) + i_side.read(u, ti) + o_side.read(v, ti) + i_side.read(v, ti)

        li = last_in.get(u)
        if li is None:
            row += [np.nan, np.nan]
        else:
            row += [ti - li[0], paid[i] / li[1] if li[1] > 0 else np.nan]

        row.append(_cycle_len(u, v, ti, last_out))
        out[i] = row

        for o_side, i_side in sides:
            o_side.add(u, ti, v)
            i_side.add(v, ti, u)
        last_in[v] = (ti, recv[i])
        nb = last_out.get(u)
        if nb is None:
            nb = last_out[u] = {}
        if v in nb:
            del nb[v]
        nb[v] = ti
        if len(nb) > NEIGHBOUR_CAP:
            del nb[next(iter(nb))]

        if verbose and i and i % 500_000 == 0:
            print(f"  graph features: {i:,}/{n:,} rows, {time.time() - t0:.0f}s", flush=True)

    return pd.DataFrame(out, columns=GRAPH_FEATURE_NAMES, index=df.index)