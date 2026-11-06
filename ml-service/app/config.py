import os
from pathlib import Path

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
MODEL_DIR = Path(os.getenv("MODEL_DIR", Path(__file__).resolve().parents[2] / "models"))
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"

# Temporal split fractions, by time order. Never shuffle.
TRAIN_FRAC = 0.60
VAL_FRAC = 0.20  # the remaining 0.20 is test

SEEDS = [11, 22, 33, 44, 55]
