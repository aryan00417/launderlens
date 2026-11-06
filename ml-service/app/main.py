from fastapi import FastAPI

app = FastAPI(title="LaunderLens ML service", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/score")
def score(payload: dict):
    """Placeholder. Month 3 replaces this with the stacked model + conformal band."""
    return {"scores": [], "note": "model not trained yet"}
