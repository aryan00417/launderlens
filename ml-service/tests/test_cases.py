import pandas as pd

from app.cases import group_alerts, group_summary


def test_alerts_sharing_accounts_form_one_group():
    df = pd.DataFrame({
        "day": ["d1", "d1", "d1", "d1", "d2"],
        "src": ["a", "b", "c", "x", "a"],
        "dst": ["b", "c", "d", "y", "b"],
        "p": [0.9, 0.8, 0.7, 0.95, 0.5],
        "label": [1, 1, 0, 0, 0],
    })
    g = group_alerts(df)
    assert g.iloc[0] == g.iloc[1] == g.iloc[2]          # a->b, b->c, c->d chain
    assert g.iloc[3] != g.iloc[0]                       # x->y is separate
    assert g.iloc[3] == "d1-G01"                        # highest probability gets G01
    assert g.iloc[4] == "d2-G01"                        # numbering restarts each day

    df["group"] = g
    s = group_summary(df)
    assert s["groups"] == 3 and s["groups_with_real"] == 1 and s["max_size"] == 3
