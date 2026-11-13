"""Evidence subgraphs: the smallest set of transactions that explains an alert,
found by explicit pattern rules, with a plain-language reason. No model involved,
so every explanation can be checked by reading the transactions."""
import numpy as np
import pandas as pd

H = 3600
# Limits below were chosen from training-period data (scripts/tune_patterns.py): real patterns span up to
# about 4 days, cycles reach 10 transfers, and a typical fan has 3-4 accounts.
WIN_BEFORE, WIN_AFTER = 96 * H, 96 * H      # window around the alert for cycles and two-hop patterns
FAN_WIN = 48 * H                            # window either side of the alert for fan-in / fan-out
GATHER_WIN = 24 * H                         # window either side of the alert for gather-scatter
CHAIN_WIN = 48 * H
FAN_MIN_OUT, FAN_MIN_IN = 5, 4              # distinct accounts needed for a fan
GATHER_MIN = 3                              # distinct accounts needed for gather/scatter layers
MAX_CYCLE = 10
CAP = 30                                    # neighbours explored per account
BUDGET = 400                                # accounts visited per cycle search
AMT_TOL = None                              # e.g. (0.8, 1.25): money passed on must stay within this ratio
MAX_SHOWN = 12                              # edges drawn per fan
CONTEXT_MAX = 40

LABELS = {
    "cycle": "Cycle", "scatter_gather": "Scatter-gather", "gather_scatter": "Gather-scatter",
    "fan_out": "Fan-out", "fan_in": "Fan-in", "chain": "Pass-through chain", "none": "No clear pattern",
}


class TxGraph:
    """Compact adjacency over a time-sorted transaction table."""

    def __init__(self, df: pd.DataFrame):
        n = len(df)
        codes, self.names = pd.factorize(pd.concat([df["src"], df["dst"]], ignore_index=True))
        self.s = codes[:n].astype(np.int32)
        self.d = codes[n:].astype(np.int32)
        self.t = df["ts"].astype("datetime64[s]").astype("int64").to_numpy()
        self.amt = df["amt_paid"].to_numpy(dtype="float64")
        self.recv = df["amt_recv"].to_numpy(dtype="float64")
        self.cur = df["cur_paid"].astype(str).to_numpy()
        self.edge_id = df["edge_id"].to_numpy()
        N = len(self.names)
        self.out_order = np.argsort(self.s, kind="stable")
        self.in_order = np.argsort(self.d, kind="stable")
        self.out_ptr = np.concatenate([[0], np.cumsum(np.bincount(self.s, minlength=N))])
        self.in_ptr = np.concatenate([[0], np.cumsum(np.bincount(self.d, minlength=N))])

    def _slice(self, order, ptr, node, t0, t1):
        idx = order[ptr[node]:ptr[node + 1]]
        if len(idx) == 0:
            return idx
        ts = self.t[idx]
        return idx[np.searchsorted(ts, t0, "left"):np.searchsorted(ts, t1, "right")]

    def out_edges(self, node, t0, t1):
        return self._slice(self.out_order, self.out_ptr, node, t0, t1)

    def in_edges(self, node, t0, t1):
        return self._slice(self.in_order, self.in_ptr, node, t0, t1)


def _span(g, edges):
    s = int(g.t[list(edges)].max() - g.t[list(edges)].min())
    if s < 3600:
        return f"{max(1, round(s / 60))} minutes"
    if s < 48 * H:
        return f"{s / 3600:.1f} hours"
    return f"{s / 86400:.1f} days"


def _keep(g, idx, e, k):
    """Up to k edges from idx, always including the alert edge, preferring larger amounts."""
    idx = [int(i) for i in idx if i != e]
    idx.sort(key=lambda i: -g.amt[i])
    return [e] + idx[: k - 1]


def _grow(g, e, backward):
    """Accounts reachable from the alert edge by a time-ordered chain, going back in time from the
    sender (backward) or on in time from the receiver. Returns {account: (edges, depth)}."""
    t = g.t[e]
    start = int(g.s[e] if backward else g.d[e])
    reach = {start: ((), 0)}
    frontier = [(start, t, ())]
    for depth in range(1, MAX_CYCLE - 1):
        nxt = []
        for node, tcur, path in frontier:
            arr = g.in_edges(node, t - WIN_BEFORE, tcur)[::-1] if backward else g.out_edges(node, tcur, t + WIN_AFTER)
            last = path[-1] if path else int(e)
            if AMT_TOL:
                lo_r, hi_r = AMT_TOL
                # the account passes on what it received: paid(next) / received(previous) stays near 1
                ratio = (g.amt[last] / np.maximum(g.recv[arr], 1e-9)) if backward else (g.amt[arr] / max(g.recv[last], 1e-9))
                arr = arr[(ratio >= lo_r) & (ratio <= hi_r)]
            for f in arr[:CAP]:
                y = int(g.s[f] if backward else g.d[f])
                if y not in reach and len(reach) < BUDGET:
                    reach[y] = (path + (int(f),), depth)
                    nxt.append((y, g.t[f], path + (int(f),)))
        frontier = nxt
        if not nxt:
            break
    return reach


def find_cycle(g, e):
    """A loop of transfers in time order that contains the alert edge. The alert edge can be any
    edge of the loop: earlier edges are found by going back from the sender, later ones forward."""
    if g.s[e] == g.d[e]:
        return None
    back, fwd = _grow(g, e, True), _grow(g, e, False)
    best = None
    for node, (bp, bd) in back.items():
        if node in fwd:
            fp, fd = fwd[node]
            edges = list(reversed(bp)) + [int(e)] + list(fp)
            if len(set(edges)) == len(edges) and len(edges) <= MAX_CYCLE and (best is None or len(edges) < len(best)):
                best = edges
    if best is None:
        return None
    n = len(best)
    return {"pattern": "cycle", "edges": best,
            "reason": f"Money left {g.names[g.s[e]]} and came back to it through {n - 1} other account{'s' if n > 2 else ''} "
                      f"within {_span(g, best)}. The {n} transfers form a closed loop."}


def _two_hop(g, e, node, forward):
    t = g.t[e]
    lo, hi = t - WIN_BEFORE, t + WIN_AFTER
    get = g.out_edges if forward else g.in_edges
    first = [int(e)] + [int(x) for x in get(node, lo, hi) if x != e][: CAP - 1]
    far = {}
    for f in first:
        m = g.d[f] if forward else g.s[f]
        if m == node:
            continue
        for h in get(m, lo, hi)[:CAP]:
            w = g.d[h] if forward else g.s[h]
            if w in (node, m):
                continue
            ordered = g.t[h] >= g.t[f] if forward else g.t[h] <= g.t[f]
            if ordered:
                far.setdefault(w, {}).setdefault(m, (f, int(h)))
    for w, mids in sorted(far.items(), key=lambda kv: -len(kv[1])):
        if len(mids) < GATHER_MIN:
            break
        edges = [x for pair in mids.values() for x in pair]
        if e in edges:
            return node, w, len(mids), edges
    return None


def find_scatter_gather(g, e):
    for node, forward in ((g.s[e], True), (g.d[e], False)):
        r = _two_hop(g, e, node, forward)
        if r:
            a, b, k, edges = r
            src, sink = (a, b) if forward else (b, a)
            return {"pattern": "scatter_gather", "edges": edges,
                    "reason": f"{g.names[src]} spread money across {k} intermediate accounts, which then all paid "
                              f"{g.names[sink]} within {_span(g, edges)}. The money was split up and brought back together."}
    return None


def find_gather_scatter(g, e):
    t = g.t[e]
    for x in (g.d[e], g.s[e]):
        ins = g.in_edges(x, t - GATHER_WIN, t + GATHER_WIN)
        outs = g.out_edges(x, t - GATHER_WIN, t + GATHER_WIN)
        a, b = len(set(g.s[ins])), len(set(g.d[outs]))
        if a >= GATHER_MIN and b >= GATHER_MIN and g.t[ins].min() <= g.t[outs].max():
            is_in = g.d[e] == x
            edges = _keep(g, ins, e if is_in else -1, 4)[(0 if is_in else 1):] + _keep(g, outs, e if not is_in else -1, 4)[(0 if not is_in else 1):]
            edges = list(dict.fromkeys(([e] if e not in edges else []) + edges))
            return {"pattern": "gather_scatter", "edges": edges,
                    "reason": f"{g.names[x]} received money from {a} different accounts and sent it on to {b} different "
                              f"accounts within {_span(g, edges)}. It collects funds and redistributes them."}
    return None


def find_fan_out(g, e):
    t, u = g.t[e], g.s[e]
    outs = g.out_edges(u, t - FAN_WIN, t + FAN_WIN)
    k = len(set(g.d[outs]))
    if k < FAN_MIN_OUT:
        return None
    return {"pattern": "fan_out", "edges": _keep(g, _first_per(g, outs, g.d), e, MAX_SHOWN),
            "reason": f"{g.names[u]} sent money to {k} different accounts within {_span(g, outs)}. "
                      "Splitting funds across many accounts is a common way to keep each transfer small."}


def find_fan_in(g, e):
    t, v = g.t[e], g.d[e]
    ins = g.in_edges(v, t - FAN_WIN, t + FAN_WIN)
    k = len(set(g.s[ins]))
    if k < FAN_MIN_IN:
        return None
    return {"pattern": "fan_in", "edges": _keep(g, _first_per(g, ins, g.s), e, MAX_SHOWN),
            "reason": f"{g.names[v]} received money from {k} different accounts within {_span(g, ins)}. "
                      "Collecting many payments into one account is a common first step of laundering."}


def find_fan(g, e):
    return find_fan_out(g, e) or find_fan_in(g, e)


def _first_per(g, idx, who):
    seen, out = set(), []
    for i in idx:
        if who[i] not in seen:
            seen.add(who[i])
            out.append(i)
    return out


def find_chain(g, e):
    edges, nodes = [e], {g.s[e], g.d[e]}

    def similar(a, b):
        return b > 0 and 0.8 <= a / b <= 1.25

    cur = e
    for _ in range(3):  # backwards from the sender
        c = [x for x in g.in_edges(g.s[cur], g.t[cur] - CHAIN_WIN, g.t[cur]) if g.s[x] not in nodes and similar(g.amt[cur], g.amt[x])]
        if not c:
            break
        cur = int(max(c, key=lambda x: g.t[x]))
        edges.insert(0, cur)
        nodes.add(g.s[cur])
    cur = e
    for _ in range(3):  # forwards from the receiver
        c = [x for x in g.out_edges(g.d[cur], g.t[cur], g.t[cur] + CHAIN_WIN) if g.d[x] not in nodes and similar(g.amt[x], g.amt[cur])]
        if not c:
            break
        cur = int(min(c, key=lambda x: g.t[x]))
        edges.append(cur)
        nodes.add(g.d[cur])
    if len(edges) < 3:
        return None
    return {"pattern": "chain", "edges": edges,
            "reason": f"The money moved through {len(edges)} transfers of similar size across {len(nodes)} accounts "
                      f"within {_span(g, edges)}, each account passing it straight on."}


RULES = (find_cycle, find_scatter_gather, find_gather_scatter, find_fan_out, find_fan_in, find_chain)


def explain(g, e):
    """The evidence subgraph for alert edge e (a row index), ready to send to the browser."""
    e = int(e)
    hits = [r for r in (rule(g, e) for rule in RULES) if r]
    found = hits[0] if hits else {"pattern": "none", "edges": [e],
        "reason": "The model rates this transfer as high risk, but no multi-account pattern was found in the "
                  "surrounding activity. Review the history of both accounts."}
    also = [h["pattern"] for h in hits[1:]]
    core = list(dict.fromkeys(int(x) for x in found["edges"]))
    nodes = {int(g.s[i]) for i in core} | {int(g.d[i]) for i in core}

    t = g.t[e]
    extra = {}
    for n in nodes:
        for arr in (g.out_edges(n, t - FAN_WIN, t + FAN_WIN), g.in_edges(n, t - FAN_WIN, t + FAN_WIN)):
            for i in arr[:CAP]:
                if int(i) not in core:
                    extra[int(i)] = g.amt[i]
    context = sorted(extra, key=lambda i: -extra[i])[:CONTEXT_MAX]

    def edge(i, in_pattern):
        return {"id": int(g.edge_id[i]), "src": str(g.names[g.s[i]]), "dst": str(g.names[g.d[i]]),
                "t": str(np.datetime64(int(g.t[i]), "s")).replace("T", " ")[:16], "amount": float(g.amt[i]),
                "currency": str(g.cur[i]), "alert": bool(i == e), "in_pattern": in_pattern}

    out_edges = [edge(i, True) for i in core] + [edge(i, False) for i in context]
    ids = {x for ed in out_edges for x in (ed["src"], ed["dst"])}
    return {"edge_id": int(g.edge_id[e]), "pattern": found["pattern"], "label": LABELS[found["pattern"]],
            "reason": found["reason"], "also": [LABELS[x] for x in also], "matches": [found["pattern"], *also],
            "size": {"edges": len(core), "accounts": len(nodes)},
            "alert_src": str(g.names[g.s[e]]), "alert_dst": str(g.names[g.d[e]]),
            "nodes": sorted(ids), "edges": sorted(out_edges, key=lambda x: x["t"])}
