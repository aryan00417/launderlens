# Roadmap (working backwards from the fixed dates)

| Date | Milestone | What must be true |
|---|---|---|
| 9-11 Dec 2026 | Review I | Title and domain locked. One-page claim: N1, N2, N3 as hypotheses. |
| by 31 Dec | Literature table | 15-20 papers in docs/research/related_work.md, novelty claim checked. |
| 15 Jan 2027 | PPT draft to guide | Sent early so approval lands before 23 Jan. |
| 23 Jan | PPT approved | Prerequisite for assessment. |
| 28-29 Jan | Review II | Lit review done, methodology written, 60-70% implemented. |
| 17 Mar | Project Expo | Live demo: alert queue, evidence subgraph, case flow. |
| 16 Apr | Report + poster | Hardcopy to guide, softcopy on Moodle. |
| 22-23 Apr | Final review | Full demo, results, paper or submission status. |

## What "60-70% implemented" means here (target by 20 Jan)
Modules 1-5 working end to end (auth, ingestion, graph builder, features, detection with
LightGBM and the GNN), module 8 first version (pattern-based evidence subgraph), module 9
(explorer showing a real subgraph). Stacker, conformal band and the rest can follow.

## Weekly order (Nov 2026)
1. Week of 9 Nov: get AMLworld HI-Small running through train_baseline.py. Record numbers.
2. Week of 16 Nov: parse_patterns.py, per-typology recall table. This table decides what N1 is about.
3. Week of 23 Nov: graph-pattern features (cycle, fan-in/out, scatter-gather) in app/graph_features.py.
4. Week of 30 Nov: Review I prep, lock title, slides.
