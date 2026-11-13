import pandas as pd

from app.evidence import TxGraph, explain


def graph(rows):
    df = pd.DataFrame(rows, columns=["src", "dst", "ts", "amt_paid"])
    df["ts"] = pd.to_datetime(df["ts"])
    df["cur_paid"] = "USD"
    df["amt_recv"] = df["amt_paid"]
    df = df.sort_values("ts", kind="stable").reset_index(drop=True)
    df["edge_id"] = df.index
    return TxGraph(df), df


def T(h, m=0):
    return f"2022-09-05 {h:02d}:{m:02d}"


def pattern(rows, i):
    g, _ = graph(rows)
    return explain(g, i)


def test_cycle_found_from_any_edge_of_the_loop():
    rows = [("A", "B", T(1), 100), ("B", "C", T(2), 99), ("C", "A", T(3), 98)]
    for i in range(3):
        r = pattern(rows, i)
        assert r["pattern"] == "cycle" and r["size"]["edges"] == 3


def test_fan_out_and_fan_in():
    out = [("A", f"B{i}", T(1, i), 50) for i in range(6)]
    r = pattern(out, 0)
    assert r["pattern"] == "fan_out" and "6 different accounts" in r["reason"]
    inn = [(f"C{i}", "D", T(1, i), 50) for i in range(6)]
    assert pattern(inn, 0)["pattern"] == "fan_in"


def test_gather_scatter():
    rows = [(f"S{i}", "X", T(1, i), 100) for i in range(3)] + [("X", f"R{i}", T(2, i), 90) for i in range(3)]
    r = pattern(rows, 0)
    assert r["pattern"] == "gather_scatter" and r["size"]["edges"] <= 8


def test_scatter_gather():
    rows = [("A", f"M{i}", T(1, i), 100) for i in range(3)] + [(f"M{i}", "Z", T(2, i), 95) for i in range(3)]
    r = pattern(rows, 0)
    assert r["pattern"] == "scatter_gather" and r["size"]["edges"] == 6


def test_chain_and_no_pattern():
    rows = [("X", "A", T(1), 100), ("A", "B", T(2), 98), ("B", "C", T(3), 96)]
    assert pattern(rows, 1)["pattern"] == "chain"
    assert pattern([("P", "Q", T(1), 10)], 0)["pattern"] == "none"


def test_output_marks_alert_and_context():
    rows = [("A", "B", T(1), 100), ("B", "C", T(2), 99), ("C", "A", T(3), 98), ("A", "Z", T(4), 5)]
    r = pattern(rows, 0)
    assert sum(e["alert"] for e in r["edges"]) == 1
    assert any(not e["in_pattern"] for e in r["edges"])        # the A->Z transfer shows as context
    assert r["alert_src"] == "A" and r["alert_dst"] == "B"


def test_amount_tolerance_removes_chance_cycles():
    import app.evidence as E
    rows = [("A", "B", T(1), 100), ("B", "C", T(2), 5), ("C", "A", T(3), 900)]   # amounts do not carry over
    try:
        E.AMT_TOL = None
        assert pattern(rows, 0)["pattern"] == "cycle"
        E.AMT_TOL = (0.8, 1.25)
        assert pattern(rows, 0)["pattern"] != "cycle"
        good = [("A", "B", T(1), 100), ("B", "C", T(2), 98), ("C", "A", T(3), 96)]
        assert pattern(good, 0)["pattern"] == "cycle"
    finally:
        E.AMT_TOL = None


def test_all_matching_patterns_are_listed():
    rows = [(f"S{i}", "X", T(1, i), 100) for i in range(3)] + [("X", f"R{i}", T(2, i), 90) for i in range(6)]
    r = pattern(rows, 3)                      # X -> R0: X gathers from 3 accounts and also fans out to 6
    assert r["pattern"] == "gather_scatter" and "fan_out" in r["matches"] and "Fan-out" in r["also"]
