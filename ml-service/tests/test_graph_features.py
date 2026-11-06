import pandas as pd

from app.graph_features import build_graph_features


def make(rows):
    df = pd.DataFrame(rows, columns=["src", "dst", "ts", "amt_paid", "amt_recv"])
    df["ts"] = pd.to_datetime(df["ts"])
    return df


def test_three_cycle_is_detected_on_closing_edge():
    f = build_graph_features(make([
        ("A", "B", "2022-09-01 01:00", 10, 10),
        ("B", "C", "2022-09-01 02:00", 9, 9),
        ("C", "A", "2022-09-01 03:00", 8, 8),
    ]))
    assert list(f["cycle_len"]) == [0, 0, 3]


def test_cycle_needs_time_order():
    f = build_graph_features(make([
        ("B", "C", "2022-09-01 01:00", 9, 9),
        ("A", "B", "2022-09-01 02:00", 10, 10),
        ("C", "A", "2022-09-01 03:00", 8, 8),
    ]))
    assert f.loc[2, "cycle_len"] == 0


def test_cycle_outside_window_is_ignored():
    f = build_graph_features(make([
        ("A", "B", "2022-09-01 01:00", 10, 10),
        ("B", "C", "2022-09-01 02:00", 9, 9),
        ("C", "A", "2022-09-06 03:00", 8, 8),
    ]))
    assert f.loc[2, "cycle_len"] == 0


def test_fan_out_counts_and_window_expiry():
    f = build_graph_features(make([
        ("A", "B", "2022-09-01 00:00", 1, 1),
        ("A", "C", "2022-09-01 00:10", 1, 1),
        ("A", "D", "2022-09-01 00:20", 1, 1),
        ("A", "E", "2022-09-01 00:30", 1, 1),
        ("A", "F", "2022-09-01 05:30", 1, 1),
    ]))
    assert f.loc[0, "src_out_d_3h"] == 0
    assert f.loc[3, "src_out_d_3h"] == 3
    assert f.loc[4, "src_out_d_3h"] == 0      # all four fell out of the 3h window
    assert f.loc[4, "src_out_d_24h"] == 4     # still inside the 24h window


def test_forwarding_features():
    f = build_graph_features(make([
        ("X", "A", "2022-09-01 00:00", 100, 100),
        ("A", "B", "2022-09-01 00:30", 98, 98),
    ]))
    assert f.loc[1, "src_since_last_in_s"] == 1800
    assert abs(f.loc[1, "fwd_ratio"] - 0.98) < 1e-6