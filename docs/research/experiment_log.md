# Experiment Log

Environment: Python 3.12.6, pandas 2.2.2, numpy 1.26.4, scikit-learn 1.5.1, lightgbm 4.5.0 (pinned in ml-service/requirements.txt).
Dataset: IBM AMLworld HI-Small, 5,078,345 transactions, 1-18 September 2022.
Split: strict temporal, 60% train / 20% val / 20% test by time order. Thresholds are picked on val only.

Open questions
- Check the AMLworld paper's generator description: do the unlabelled laundering edges (1,968) belong to placement/integration steps outside the pattern file?
- cycle_len is not used by the model so far. Verify the cycle search finds cycles (Run 04 prints this).

---

## Run 01 - first baseline (SUPERSEDED by Run 02)

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Superseded because:** the metrics include 8 near-empty tail days (11-18 Sep, under 400 transactions per day, 655 of the 1,797 test positives). Those days are over half laundering, so PR-AUC, F1 and Recall@K are inflated. Kept for the record only.
- **Note on Recall@K:** in this run K is alerts reviewed per day (K=10, 50, 200), not a global top-K. At K=10 the 11 test days allow only 110 reviews, so recall cannot exceed about 6%.

### Commands

```bash
python -m scripts.parse_patterns HI-Small
python -m scripts.train_baseline HI-Small
python -m scripts.diagnose HI-Small
```

### Pattern parsing

- Laundering edges in CSV: 5,177
- Edges assigned a typology: 3,209 (62.0%)
- Unlabelled laundering edges: 1,968

| Typology | Count |
|---|---:|
| GATHER-SCATTER | 716 |
| SCATTER-GATHER | 626 |
| STACK | 466 |
| FAN-OUT | 342 |
| FAN-IN | 318 |
| CYCLE | 287 |
| BIPARTITE | 263 |
| RANDOM | 191 |
| Unlabelled | 1,968 |

### Baseline results (all test rows)

- Train / val / test: 3,047,007 / 1,015,669 / 1,015,669
- Illicit share: train 0.0754%, test 0.1769%. Positives in test: 1,797.

| Metric | Logistic Regression | LightGBM |
|---|---:|---:|
| Threshold | 0.8948 | 0.8019 |
| PR-AUC | 0.00805 | 0.28132 |
| Minority F1 | 0.01465 | 0.34717 |
| Flagged | 128,021 | 732 |
| Recall at K=10/day | 4.06% | 5.01% |
| Recall at K=50/day | 14.47% | 19.14% |
| Recall at K=200/day | 33.33% | 46.52% |

LightGBM recall by typology (all test rows):

| Typology | Recall | Test samples |
|---|---:|---:|
| BIPARTITE | 0.243 | 74 |
| CYCLE | 0.202 | 109 |
| FAN-IN | 0.343 | 137 |
| FAN-OUT | 0.414 | 140 |
| GATHER-SCATTER | 0.322 | 401 |
| RANDOM | 0.326 | 86 |
| SCATTER-GATHER | 0.365 | 252 |
| STACK | 0.300 | 140 |
| UNLABELLED | 0.007 | 458 |

### Diagnostics (diagnose.py)

- Rows in patterns file: 3,209. Laundering edges in CSV: 5,177.
- Unlabelled edges whose sender/receiver pair appears in the patterns file: 0 of 1,968. So the join is fine; these edges are simply not in the file.
- Normal traffic stops after day 10: days 11-18 have 396 rows or fewer, and over half are laundering. Unlabelled laundering edges appear only on days 1-10.

| Payment format | Unlabelled | Labelled |
|---|---:|---:|
| ACH | 1,275 | 3,208 |
| Cheque | 324 | 0 |
| Credit Card | 206 | 0 |
| Cash | 108 | 0 |
| Bitcoin | 55 | 1 |

**What I think it means:** the pattern file seems to cover only the layering step (money moved by ACH inside the network). The unlabelled edges look like money entering or leaving the network (cheque, cash, card, bitcoin). Not yet checked against the AMLworld paper.

---

## Run 02 - corrected baseline

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_baseline HI-Small`
- **Change from Run 01:** metrics computed on full test days only (rows >= 100,000 per day: 3 days, 1,142 laundering edges). K = 100, 300, 1000 alerts per day.
- **LightGBM settings:** 400 trees, learning rate 0.05, 63 leaves, scale_pos_weight capped at 50, colsample 0.8, no row bagging (subsample has no effect without subsample_freq), seeds 11, 22, 33, 44, 55 averaged.

| Metric (full days) | Logistic Regression | LightGBM |
|---|---:|---:|
| PR-AUC | 0.00476 | 0.15972 |
| Minority F1 | 0.00907 | 0.27184 |
| Flagged | 127,620 | 506 |
| Recall at K=100/day | 0.18% | 12.78% |
| True per 100 reviewed, K=100 | 0.67 | 48.7 |
| Recall at K=300/day | 0.35% | 24.96% |
| True per 100 reviewed, K=300 | 0.44 | 31.7 |
| Recall at K=1000/day | 1.49% | 37.04% |
| True per 100 reviewed, K=1000 | 0.57 | 14.1 |

Recall ceiling: K=100/day over 3 days reviews 300 alerts, so recall cannot exceed 26% (300 of 1,142).
Per-typology recall: same table as Run 01 (computed on all test rows).

**What I think it means:** the honest baseline is PR-AUC 0.16 and F1 0.27. Logistic regression is only a floor. Patterns that depend on network shape (cycles, bipartite) are missed most.

---

## Run 03 - graph features (PROVISIONAL, not comparable with Run 02)

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_graph HI-Small`
- **Graph features:** windows 3h and 24h, cycle window 72h, max cycle length 5, neighbour cap 30, search budget 80. Build time about 135 s. Cached in data/processed/HI-Small_graphfeat.parquet.
- **Known problem:** LightGBM ran with subsample_freq=1 (row bagging on) and 3 seeds (11, 22, 33). Run 02 had no bagging and 5 seeds. The base model fell from PR-AUC 0.160 to 0.047, so numbers here must not be compared with Run 02. The base-vs-graph comparison inside this run uses identical settings.

| Metric (full days) | Base | Base + graph |
|---|---:|---:|
| PR-AUC | 0.0472 | 0.0863 |
| Minority F1 | 0.1727 | 0.2353 |
| Flagged | 1,823 | 2,980 |
| Recall at K=100/day | 4.0% | 5.0% |
| Recall at K=300/day | 9.0% | 12.0% |
| Recall at K=1000/day | 26.0% | 34.9% |
| True per 100 reviewed, K=100 | 15.3 | 19.0 |
| True per 100 reviewed, K=300 | 11.4 | 15.2 |
| True per 100 reviewed, K=1000 | 9.9 | 13.3 |

Recall by typology with the top 1,000 alerts reviewed (full days):

| Typology | Base | Graph | n |
|---|---:|---:|---:|
| BIPARTITE | 0.500 | 0.654 | 52 |
| CYCLE | 0.323 | 0.523 | 65 |
| FAN-IN | 0.310 | 0.592 | 71 |
| FAN-OUT | 0.311 | 0.770 | 74 |
| GATHER-SCATTER | 0.320 | 0.707 | 147 |
| RANDOM | 0.356 | 0.556 | 45 |
| SCATTER-GATHER | 0.325 | 0.667 | 123 |
| STACK | 0.364 | 0.607 | 107 |
| UNLABELLED | 0.048 | 0.081 | 458 |

Top features by gain (graph model): src_gap_s 0.518, src_prior_out 0.116, src_since_last_in_s 0.062, dst_prior_out 0.039, log_amt 0.035, dst_in_n_3h 0.029. cycle_len is not in the top 10.

**What I think it means:** graph features lift every typology, but the setup is unreliable and two basic features dominate. All 458 unlabelled edges fall on full days (40% of positives) and are barely caught, which caps recall for any model that only learns the labelled patterns. src_prior_out is a running count that grows over time, so test values fall outside the training range. The CYCLE lift probably comes from activity counts, not from cycle_len.

---

## Run 04 - graph features, no bagging, 5 seeds

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_graph HI-Small` (DROP = ())
- **Settings:** same LightGBM as Run 02 (400 trees, 63 leaves, no row bagging), seeds 11, 22, 33, 44, 55. Scores averaged over seeds, then evaluated on the 3 full test days (1,142 laundering edges).
- **Prediction that failed:** I expected base PR-AUC to return to about 0.16 (Run 02). It came back at 0.22 with the same settings, so results are not reproducible to within about 0.06.

| Metric | Base | Base + graph |
|---|---:|---:|
| PR-AUC (5-seed average) | 0.2196 | 0.2428 |
| Minority F1 | 0.3455 | 0.4018 |
| Flagged | 554 | 590 |
| PR-AUC per seed | 0.036, 0.017, 0.012, 0.027, 0.025 | 0.025, 0.028, 0.044, 0.008, 0.012 |
| Recall at K=100/day | 15.1% | 13.3% |
| Recall at K=300/day | 31.8% | 33.9% |
| Recall at K=1000/day | 45.8% | 51.2% |
| True per 100 reviewed, K=100 | 57.3 | 50.7 |
| True per 100 reviewed, K=300 | 40.3 | 43.0 |
| True per 100 reviewed, K=1000 | 17.4 | 19.5 |

Recall by typology, top 1,000 alerts reviewed (base / graph): BIPARTITE 0.577 / 0.692, CYCLE 0.492 / 0.723, FAN-IN 0.535 / 0.775, FAN-OUT 0.743 / 0.878, GATHER-SCATTER 0.673 / 0.803, RANDOM 0.556 / 0.733, SCATTER-GATHER 0.610 / 0.732, STACK 0.542 / 0.673, UNLABELLED 0.037 / 0.055.
Cycle check: 5.2% of laundering edges close a cycle vs 0.1% of clean edges. By typology: BIPARTITE 0.135, CYCLE 0.092, FAN-IN 0.056, FAN-OUT 0.068, GATHER-SCATTER 0.061, RANDOM 0.133, SCATTER-GATHER 0.073, STACK 0.047.
Top features by gain: log_amt 0.536, pair_prior 0.089, hour 0.063, src_gap_s 0.060, src_prior_in 0.053.

**What I think it means:** per-seed PR-AUC (about 0.02) is far below the ensemble PR-AUC, so single models are unstable and averaging hides it. Per seed, base and graph are equal (mean 0.023 each). The ensemble gain from graph features is small here. A cycle can only flag its closing edge, so cycle_len fires on at most about 1 in 5 edges of a cycle; alerts should be subgraphs that are re-scored when a cycle closes.

## Run 05 - ablation: drop src_gap_s and src_prior_out

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_graph HI-Small` (DROP = ("src_gap_s", "src_prior_out")), otherwise as Run 04.

| Metric | Base | Base + graph |
|---|---:|---:|
| PR-AUC (5-seed average) | 0.0710 | 0.1531 |
| Minority F1 | 0.1742 | 0.3276 |
| Flagged | 1,258 | 891 |
| PR-AUC per seed | 0.022, 0.019, 0.005, 0.023, 0.006 | 0.016, 0.012, 0.019, 0.014, 0.012 |
| Recall at K=100/day | 4.9% | 9.0% |
| Recall at K=300/day | 14.4% | 29.4% |
| Recall at K=1000/day | 29.4% | 37.0% |
| True per 100 reviewed, K=100 | 18.7 | 34.3 |
| True per 100 reviewed, K=300 | 18.3 | 37.3 |
| True per 100 reviewed, K=1000 | 11.2 | 14.1 |

Recall by typology, top 1,000 alerts reviewed (base / graph): BIPARTITE 0.250 / 0.462, CYCLE 0.292 / 0.431, FAN-IN 0.197 / 0.535, FAN-OUT 0.351 / 0.541, GATHER-SCATTER 0.306 / 0.476, RANDOM 0.200 / 0.511, SCATTER-GATHER 0.252 / 0.488, STACK 0.299 / 0.421, UNLABELLED 0.044 / 0.020.
Top features by gain: fwd_ratio 0.271, src_since_last_in_s 0.209, pair_prior 0.079, log_amt 0.074, dst_prior_out 0.059.

**What I think it means:** without the two dropped features the base model falls from PR-AUC 0.22 to 0.07, so they were carrying it. src_prior_out grows over time (train/test drift) and src_gap_s may be a generator artifact. Graph features lift every labelled typology, strongest evidence for N1 so far. Single-seed PR-AUC is again about 0.015, so the ensemble numbers still need the variance fix.

## Run 06 - regularised LightGBM with early stopping, all features

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_graph HI-Small` (DROP = ())
- **Settings:** 15 leaves, min_child_samples 200, reg_lambda 10, up to 1,000 trees, early stopping (50 rounds) on val average precision, deterministic, seeds 11, 22, 33, 44, 55.
- **Trees used (base):** 3, 2, 1000, 673, 3. **(graph):** 9, 2, 996, 507, 22. Early stopping is erratic.

| Metric (3 full test days) | Base | Base + graph |
|---|---:|---:|
| PR-AUC, ensemble | 0.3511 | 0.4437 |
| PR-AUC per seed | 0.238, 0.379, 0.065, 0.207, 0.262 | 0.134, 0.367, 0.113, 0.366, 0.302 |
| Minority F1 | 0.4147 | 0.4795 |
| Recall at K=100/day | 21.4% | 22.6% |
| Recall at K=300/day | 34.6% | 41.5% |
| Recall at K=1000/day | 45.3% | 54.8% |
| True per 100 reviewed, K=100 | 81.3 | 86.0 |
| True per 100 reviewed, K=300 | 43.9 | 52.7 |
| True per 100 reviewed, K=1000 | 17.2 | 20.9 |

Recall by typology, top 1,000 alerts (base / graph): BIPARTITE 0.538 / 0.692, CYCLE 0.462 / 0.646, FAN-IN 0.577 / 0.676, FAN-OUT 0.595 / 0.743, GATHER-SCATTER 0.571 / 0.741, RANDOM 0.533 / 0.711, SCATTER-GATHER 0.480 / 0.634, STACK 0.607 / 0.645, UNLABELLED 0.022 / 0.033.
Feature importance is from the last seed's model (22 trees): not reliable.

## Run 07 - regularised, drop src_gap_s and src_prior_out

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_graph HI-Small` (DROP = ("src_gap_s", "src_prior_out")), otherwise as Run 06.
- **Trees used (base):** 436, 14, 325, 529, 634. **(graph):** 594, 998, 4, 251, 997.

| Metric (3 full test days) | Base | Base + graph |
|---|---:|---:|
| PR-AUC, ensemble | 0.0961 | 0.4212 |
| PR-AUC per seed | 0.097, 0.042, 0.071, 0.035, 0.081 | 0.378, 0.260, 0.168, 0.381, 0.273 |
| Minority F1 | 0.1171 | 0.4112 |
| Recall at K=100/day | 7.1% | 22.6% |
| Recall at K=300/day | 16.7% | 37.0% |
| Recall at K=1000/day | 30.0% | 56.0% |
| True per 100 reviewed, K=100 | 27.0 | 86.0 |
| True per 100 reviewed, K=300 | 21.2 | 47.0 |
| True per 100 reviewed, K=1000 | 11.4 | 21.3 |

Recall by typology, top 1,000 alerts (base / graph): BIPARTITE 0.115 / 0.538, CYCLE 0.185 / 0.538, FAN-IN 0.113 / 0.620, FAN-OUT 0.176 / 0.541, GATHER-SCATTER 0.211 / 0.605, RANDOM 0.067 / 0.511, SCATTER-GATHER 0.138 / 0.577, STACK 0.150 / 0.533, UNLABELLED 0.041 / 0.039.
Top features by gain (graph model, seed 55, 997 trees): log_amt 0.325, pair_prior 0.272, fwd_ratio 0.148, fmt 0.101, dst_in_d_24h 0.036.

**What I think it means:** every graph seed beats every base seed here (0.168-0.381 vs 0.035-0.097). Fair framing: the strongest plain baseline is base with src_gap_s and src_prior_out (Run 06: ensemble 0.35, per-seed mean 0.23). The graph model reaches 0.42-0.44 without needing those two features, while the base model without them collapses. The graph-vs-strong-baseline gain is modest; the graph-vs-no-shortcut gain is large. Caveat: settings were changed after looking at test results over several runs, so replicate on untouched data (LI-Small) with the config frozen.

## Run 08 - fixed 300 trees, all features

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_graph HI-Small` (DROP = ())
- **Settings:** 300 trees, learning rate 0.05, 15 leaves, min_child_samples 200, reg_lambda 10, colsample 0.8, deterministic, seeds 11, 22, 33, 44, 55. No early stopping.

| Metric (3 full test days) | Base | Base + graph |
|---|---:|---:|
| PR-AUC, ensemble | 0.4146 | 0.4383 |
| PR-AUC per seed (test) | 0.190, 0.362, 0.069, 0.198, 0.190 | 0.105, 0.221, 0.108, 0.358, 0.283 |
| PR-AUC per seed (val) | 0.151, 0.329, 0.410, 0.241, 0.305 | 0.146, 0.316, 0.257, 0.414, 0.289 |
| Minority F1 | 0.4378 | 0.5071 |
| Flagged | 393 | 747 |
| Recall at K=100/day | 22.2% | 21.5% |
| Recall at K=300/day | 40.4% | 45.1% |
| Recall at K=1000/day | 53.2% | 58.5% |
| True per 100 reviewed, K=100 | 84.7 | 81.7 |
| True per 100 reviewed, K=300 | 51.2 | 57.2 |
| True per 100 reviewed, K=1000 | 20.2 | 22.3 |

Recall by typology, top 1,000 alerts (base / graph): BIPARTITE 0.692 / 0.769, CYCLE 0.615 / 0.662, FAN-IN 0.690 / 0.746, FAN-OUT 0.851 / 0.811, GATHER-SCATTER 0.707 / 0.769, RANDOM 0.644 / 0.711, SCATTER-GATHER 0.626 / 0.732, STACK 0.673 / 0.710, UNLABELLED 0.020 / 0.031.

## Run 09 - fixed 300 trees, drop src_gap_s and src_prior_out

- **Date:** 5 November 2026
- **Commit:** f253b00
- **Command:** `python -m scripts.train_graph HI-Small` (DROP = ("src_gap_s", "src_prior_out")), otherwise as Run 08.

| Metric (3 full test days) | Base | Base + graph |
|---|---:|---:|
| PR-AUC, ensemble | 0.0953 | 0.4494 |
| PR-AUC per seed (test) | 0.094, 0.061, 0.071, 0.033, 0.077 | 0.367, 0.204, 0.203, 0.383, 0.209 |
| PR-AUC per seed (val) | 0.142, 0.105, 0.154, 0.049, 0.099 | 0.444, 0.263, 0.313, 0.521, 0.281 |
| Minority F1 | 0.1499 | 0.4693 |
| Flagged | 2,461 | 648 |
| Recall at K=100/day | 7.5% | 22.8% |
| Recall at K=300/day | 17.8% | 40.7% |
| Recall at K=1000/day | 31.3% | 54.9% |
| True per 100 reviewed, K=100 | 28.7 | 86.7 |
| True per 100 reviewed, K=300 | 22.6 | 51.7 |
| True per 100 reviewed, K=1000 | 11.9 | 20.9 |

Recall by typology, top 1,000 alerts (base / graph): BIPARTITE 0.135 / 0.654, CYCLE 0.185 / 0.538, FAN-IN 0.127 / 0.648, FAN-OUT 0.162 / 0.662, GATHER-SCATTER 0.190 / 0.735, RANDOM 0.133 / 0.556, SCATTER-GATHER 0.138 / 0.642, STACK 0.150 / 0.589, UNLABELLED 0.039 / 0.039.
Top features by gain (graph model, seed 55): log_amt 0.328, pair_prior 0.276, fwd_ratio 0.148, fmt 0.102, dst_in_d_24h 0.033.

**What I think it means:**
- With all features, base and graph are about equal (ensemble 0.415 vs 0.438, per-seed mean 0.20 vs 0.215), within seed noise.
- Without the two timing/count features, the base model collapses (0.095) and the graph model does not (0.449). Every graph seed beats every base seed, on both val and test. Same result as Run 07 (0.421), so it replicates.
- Claim for the paper: graph features make the detector independent of two features that may be dataset artifacts. Do not claim they beat the strongest baseline.
- Single seeds still vary a lot and val per seed does not predict test per seed (base seed 33: val 0.410, test 0.069), so the 5-seed ensemble is the final model and per-seed numbers go in the paper too.
- Recall at K=1000/day (about 0.55-0.585) is near the 59.9% of positives that carry a typology label (684 of 1,142). The 458 unlabelled edges (40%) are caught at about 3%. Next lever: account-level risk (GNN) for those.

**Decision:** LightGBM frozen (300 trees, 15 leaves, 5 seeds). No more tuning on HI-Small test. Next: replicate on LI-Small with this exact config.

## Run 10 - LI-Small replication, all features (frozen config)

- **Date:** 6 November 2026
- **Commit:** 208184a
- **Command:** `python -m scripts.train_graph LI-Small` (DROP = ())
- **Settings:** same as Run 08: 300 trees, 15 leaves, min_child_samples 200, reg_lambda 10, seeds 11, 22, 33, 44, 55. No changes.
- **Data:** LI-Small, 6,924,049 rows, 3,565 laundering edges. Only 28.7% have a typology (1,023). Test: 3 full days, 791 laundering edges, 582 unlabelled (74%; HI-Small was 40%).

| Metric (3 full test days) | Base | Base + graph |
|---|---:|---:|
| PR-AUC, ensemble | 0.0663 | 0.0452 |
| PR-AUC per seed (test) | 0.045, 0.028, 0.024, 0.014, 0.005 | 0.015, 0.027, 0.019, 0.017, 0.021 |
| PR-AUC per seed (val) | 0.051, 0.041, 0.042, 0.018, 0.048 | 0.032, 0.041, 0.038, 0.028, 0.031 |
| Minority F1 | 0.0787 | 0.0977 |
| Flagged | 124 | 1,358 |
| Recall at K=100/day | 8.7% | 4.8% |
| Recall at K=300/day | 12.4% | 10.4% |
| Recall at K=1000/day | 19.3% | 21.1% |
| True per 100 reviewed, K=100 | 23.0 | 12.7 |
| True per 100 reviewed, K=300 | 10.9 | 9.1 |
| True per 100 reviewed, K=1000 | 5.1 | 5.6 |

Recall by typology, top 1,000 alerts (base / graph, n): BIPARTITE 0.500 / 0.316 (38), CYCLE 0.421 / 0.474 (19), FAN-IN 0.286 / 0.143 (7), FAN-OUT 0.429 / 0.179 (28), GATHER-SCATTER 0.344 / 0.250 (32), RANDOM 0.300 / 0.200 (20), SCATTER-GATHER 0.239 / 0.326 (46), STACK 0.526 / 0.368 (19), UNLABELLED 0.031 / 0.040 (582).
Cycle check: 2.1% of laundering edges close a cycle vs 0.1% of clean edges. By typology: CYCLE 0.105, STACK 0.105, SCATTER-GATHER 0.043, all others 0.
Top features by gain (graph model, seed 55): log_amt 0.314, pair_prior 0.162, fwd_ratio 0.095, fmt 0.094, src_out_d_24h 0.075.

**What I think it means:** the HI-Small result did not replicate with all features: base and graph are about equal, with graph slightly worse on several numbers. Absolute scores are very low (PR-AUC 0.05-0.07 vs 0.4 on HI-Small). 74% of test laundering edges have no typology label, so pattern features have little to see, and typology groups are tiny (n = 7-46), so per-typology numbers are noise. The comparison that decided the HI-Small result (dropping src_gap_s and src_prior_out) is Run 11.

## Run 11 - LI-Small, drop src_gap_s and src_prior_out

- **Date:** 6 November 2026
- **Commit:** 208184a
- **Command:** `python -m scripts.train_graph LI-Small` (DROP = ("src_gap_s", "src_prior_out")), otherwise as Run 10 (frozen config).

| Metric (3 full test days, 791 laundering edges) | Base | Base + graph |
|---|---:|---:|
| PR-AUC, ensemble | 0.0248 | 0.0917 |
| PR-AUC per seed (test) | 0.015, 0.009, 0.029, 0.016, 0.015 | 0.032, 0.100, 0.055, 0.055, 0.023 |
| PR-AUC per seed (val) | 0.035, 0.013, 0.034, 0.022, 0.023 | 0.052, 0.115, 0.031, 0.101, 0.030 |
| Minority F1 | 0.0590 | 0.1367 |
| Flagged | 836 | 277 |
| Recall at K=100/day | 4.0% | 11.0% |
| Recall at K=300/day | 7.0% | 16.2% |
| Recall at K=1000/day | 15.4% | 27.8% |
| True per 100 reviewed, K=100 | 10.7 | 29.0 |
| True per 100 reviewed, K=300 | 6.1 | 14.2 |
| True per 100 reviewed, K=1000 | 4.1 | 7.3 |

Recall by typology, top 1,000 alerts (base / graph, n): BIPARTITE 0.211 / 0.579 (38), CYCLE 0.211 / 0.684 (19), FAN-IN 0.143 / 0.571 (7), FAN-OUT 0.107 / 0.357 (28), GATHER-SCATTER 0.188 / 0.688 (32), RANDOM 0.350 / 0.400 (20), SCATTER-GATHER 0.217 / 0.435 (46), STACK 0.211 / 0.632 (19), UNLABELLED 0.029 / 0.048 (582).
Top features by gain (graph model, seed 55): fwd_ratio 0.279, pair_prior 0.215, log_amt 0.176, fmt 0.128, dst_in_n_3h 0.042.

### Frozen-config summary (ensemble PR-AUC, 3 full test days)

| Dataset | Features | Base | Base + graph |
|---|---|---:|---:|
| HI-Small (Runs 08, 09) | all | 0.415 | 0.438 |
| HI-Small | without src_gap_s, src_prior_out | 0.095 | 0.449 |
| LI-Small (Runs 10, 11) | all | 0.066 | 0.045 |
| LI-Small | without src_gap_s, src_prior_out | 0.025 | 0.092 |

**What I think it means:** the HI-Small pattern repeats on LI-Small. With the two timing/count features, base and graph are about equal. Without them, the base model collapses and the graph model holds. The graph model without those two features matches or beats the best plain baseline on both datasets (0.449 vs 0.415, 0.092 vs 0.066). Limits: seeds overlap a little on LI-Small (graph min 0.023, base max 0.029), absolute scores are low, 74% of test laundering edges on LI-Small are unlabelled, typology groups are tiny (n = 7-46), and each test set is only 3 days.

**Decision:** the main system model is "base features minus src_gap_s and src_prior_out, plus graph features" (DROP = both). Report the all-features comparison too.


---

## Run 12 - alert prioritisation on HI-Small (final model)

- **Date:** (fill in)
- **Commit:** (fill in)
- **Commands:** `python -m scripts.train_final HI-Small`, then `python -m scripts.prioritise HI-Small`
- **Model:** frozen config (300 trees, 15 leaves, 5 seeds averaged), without src_gap_s and src_prior_out, plus graph features. Calibration (Platt scaling) and conformal bands fitted on the validation days (1,015,669 rows, 1,082 laundering). Evaluated on 3 full test days (1,014,561 rows, 1,142 laundering).
- **Reproducibility:** K=100/day gives recall 22.8% and 86.7 real per 100, same as Run 09.

### Calibration

Brier score 0.003985 (raw) to 0.000806 (calibrated). Calibration error 0.01312 to 0.00026.

| Range (calibrated) | Rows | Avg predicted | Actual rate |
|---|---:|---:|---:|
| 0 to 0.001 | 901,688 | 0.0000 | 0.0000 |
| 0.001 to 0.01 | 102,901 | 0.0026 | 0.0023 |
| 0.01 to 0.05 | 6,874 | 0.0224 | 0.0310 |
| 0.05 to 0.2 | 2,162 | 0.0904 | 0.0930 |
| 0.2 to 0.5 | 386 | 0.3096 | 0.1244 |
| 0.5 to 1 | 550 | 0.8910 | 0.7309 |

Top 200 alerts per day, real cases expected vs found: 8 Sep 68.7 vs 80, 9 Sep 175.2 vs 171, 10 Sep 196.1 vs 164 (total 440 vs 415).

### Daily review budget (test days)

| K per day | Recall | Real per 100 reviewed | Max possible recall |
|---:|---:|---:|---:|
| 25 | 6.5% | 98.7 | 6.6% |
| 50 | 12.8% | 97.3 | 13.1% |
| 100 | 22.8% | 86.7 | 26.3% |
| 200 | 36.3% | 69.2 | 52.5% |
| 300 | 40.7% | 51.7 | 78.8% |
| 500 | 46.6% | 35.5 | 100% |

Baselines: largest amount first 0.0-0.2% recall and 0.1-0.3 real per 100 at every K; random 0.

### Conformal bands (alpha_pos 0.20, alpha_neg 0.0005)

- Real laundering still inside the "could be laundering" set: 0.786 (target 0.80).
- Clean rows reaching "confident alert" level: 0.00091 (target at most 0.0005).

| Band (top 200 per day, 3 days) | Alerts | Real | Real per 100 |
|---|---:|---:|---:|
| confident alert | 511 | 401 | 78.5 |
| uncertain | 89 | 14 | 15.7 |

**What I think it means:** calibration works in the middle ranges but is overconfident at the top (0.89 predicted vs 0.73 real), and daily totals are off by up to 20% because the laundering rate changes from day to day. At 100 alerts a day the model finds 87% of the most any ranking could. The two naive baselines are weak; a rules baseline and the plain LightGBM are the fair comparisons (Run 09 plain LightGBM at K=100: 7.5% recall, 28.7 real per 100). The conformal promise holds for real laundering (78.6% vs 80%) but is about 1.8 times too loose on false alarms, most likely because the test days differ from the validation days. The bands split the queue into groups with a 5 times difference in real cases per 100. Each alert is one transaction, so alerts from the same laundering chain are counted separately; next step is grouping alerts into cases and counting cases.


---

## Run 13 - probability tie fix

- **Date:** (fill in)
- **Commit:** (fill in)
- **Change:** logit clip in `app/prioritise.py` from 1e-6 to 1e-12. Before, all very confident alerts got the same probability (0.99994948), so their order inside the top group was arbitrary (time order).
- **Command:** `python -m scripts.prioritise HI-Small` (no retraining)
- **Result:** alerts in the top 200/day sharing a probability with another alert: 39 of 600. Brier 0.000806 to 0.000804. K=50/day: real per 100 97.3 to 98.0, recall 12.8% to 12.9%. All other budget numbers unchanged. Conformal numbers and band split unchanged (confident 511 alerts, 401 real; uncertain 89 alerts, 14 real).
- **Remaining ties:** the mean of the 5 models' probabilities reaches 1.0 at float precision for the most confident rows. Fix at the next retrain: save raw log-odds (`predict(raw_score=True)`) instead of probabilities.

---

## Run 14 - evidence subgraphs on HI-Small alerts (first version)

- **Date:** (fill in)
- **Commit:** (fill in)
- **Command:** `python -m scripts.build_evidence HI-Small`
- **Rules (set before looking at data):** fan needs 5 accounts within 24h either side, gather/scatter layers need 3, cycle up to 6 transfers within 72h before / 24h after the alert.
- **Alerts:** 600 (top 200 per day, 3 days), 415 real, 185 false alarms. Median explanation size 4 transactions (largest 26).

| Rule | Times fired | Of those, real alerts |
|---|---:|---:|
| Fan-out | 76 | 97% |
| Gather-scatter | 120 | 95% |
| Scatter-gather | 31 | 87% |
| Chain | 16 | 69% |
| Fan-in | 66 | 65% |
| Cycle | 91 | 33% |
| No pattern | 200 | 58% |

Real alerts are 69% of the queue, so the cycle rule is worse than no information. It caught 3 of 26 true CYCLE alerts (11.5%). Expected rule fired for the other types: fan-out 39%, fan-in 62%, gather-scatter 43%, scatter-gather 37%. Stack and bipartite have no rule (mostly "no pattern").

**What I think it means:** fan-out, gather-scatter and scatter-gather rules are precise. The cycle rule is too loose on accidental loops and too short to see real cycles.

## Run 15 - pattern statistics from the dataset's own pattern file

- **Date:** (fill in)
- **Commit:** (fill in)
- **Command:** `python -m scripts.pattern_stats HI-Small` (attempts finished before the training cutoff, 2022-09-06 13:36: 104 of 370)

| Pattern | Attempts | Edges (median / p95) | Span in hours (median / p95) | Notes |
|---|---:|---|---|---|
| Cycle | 19 | 3 / 10 | 70 / 90 | gaps up to 77h between transfers |
| Fan-out | 17 | 4 / 13.6 | 72 / 90 | median 4 destinations, max 16 |
| Fan-in | 9 | 3 / 13.6 | 54 / 88 | median 3 senders, max 16 |
| Gather-scatter | 8 | 2 / 6.9 | 6 / 102 | hub: median 2 in, 1 out |
| Scatter-gather | 9 | 6 / 31 | 80 / 95 | median 3 branches, max 16 |
| Stack | 8 | 2 / 21 | 60 / 91 | |
| Bipartite | 22 | 4.5 / 13 | 27 / 45 | |
| Random | 12 | 2 / 8.4 | 23 / 86 | |

**What I think it means:** patterns last up to about 4 days. The rules' windows (24h, 72h) and sizes (5 accounts, 6 transfers) were too short and too large. Small samples (8 to 22 attempts per type). Next: Run 16, `tune_patterns` on training data only.