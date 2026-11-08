import numpy as np
import pandas as pd
from app.prioritise import ConformalBands, PlattCalibrator, top_k_flags


def test_calibrator_keeps_order_near_one():
       rng = np.random.default_rng(0)
       s = np.concatenate([rng.uniform(0, 0.5, 5000), rng.uniform(0.9, 1, 500)])
       y = (rng.random(len(s)) < s ** 3).astype(int)
       p = PlattCalibrator().fit(s, y).predict(np.array([0.9999995, 0.9999999, 0.99999999]))
       assert p[0] < p[1] < p[2]          # very confident scores must not collapse to one value


def test_conformal_p_values():
       cb = ConformalBands(np.array([0.1, 0.2, 0.3, 0.9, 0.95]), np.array([0, 0, 0, 1, 1]))
       p0, p1 = cb.p_values(np.array([0.99, 0.15]))
       assert p0[0] < p0[1]               # higher score: rarer among clean rows
       assert p1[0] > p1[1]               # higher score: more like known laundering


def test_top_k_per_day():
       df = pd.DataFrame({
           "ts": pd.to_datetime(["2022-09-01 01:00", "2022-09-01 02:00", "2022-09-02 01:00", "2022-09-02 02:00"]),
           "p": [0.9, 0.1, 0.2, 0.8],
       })
       assert list(top_k_flags(df, "p", 1)) == [True, False, False, True]