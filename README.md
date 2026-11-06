# LaunderLens

Graph-based money laundering detection with evidence subgraphs and budget-aware alert ranking.
See docs/ROADMAP.md for dates and the weekly order.

## Run the ML baseline (no Docker needed)

1. Download the IBM AMLworld files from Kaggle ("IBM Transactions for Anti Money Laundering").
   Put `HI-Small_Trans.csv` and `HI-Small_Patterns.txt` in `data/raw/`.
2. Then:

    cd ml-service
    python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    python -m scripts.parse_patterns HI-Small
    python -m scripts.train_baseline HI-Small
    pytest

## Run the full stack

    cp .env.example .env        # edit the secrets
    docker compose up --build
    docker compose exec backend npm run seed     # creates admin@launderlens.local / admin123

Open http://localhost:5173. API health: http://localhost:4000/api/health. ML docs: http://localhost:8000/docs.

## Layout
- ml-service: FastAPI, data loading, features, metrics, training scripts
- backend: Express API, auth and roles, audit log, Postgres schema
- frontend: React app (login, overview, graph explorer)
- docs, paper: research log, roadmap, paper outline
