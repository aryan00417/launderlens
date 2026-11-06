# Paper outline (write each section while building the matching module)

1. Introduction: investigator workload, what the 3 contributions test.
2. Related work: from docs/research/related_work.md.
3. Data and split: AMLworld, strict temporal split, synthetic-data limits.
4. Method: pattern features, directed-multigraph GNN, LightGBM, gate, calibration, conformal band.
5. Prioritisation: Recall@K under a daily budget.
6. Explanation: evidence subgraph vs GNNExplainer (fidelity, size).
7. Results: per-typology table, Recall@K curves, ablations, 5 seeds with CI.
8. Limits: synthetic data, no real investigator study.
