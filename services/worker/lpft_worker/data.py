from __future__ import annotations

from pathlib import Path

import pandas as pd

from lpft_worker.config import settings

PERIOD_ALIAS = {"1m": "1mo", "3m": "3mo", "6m": "6mo", "1y": "1y", "2y": "2y", "5y": "5y"}


def dataset_path(filename: str) -> Path:
    return Path(settings.storage_dir) / "datasets" / filename


def load_ohlcv_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, index_col=0, parse_dates=True)
    for c in ["open", "high", "low", "close", "volume"]:
        if c not in df.columns:
            raise ValueError(f"Missing column {c}")
    return df


def slice_ohlcv_by_period(ohlcv: pd.DataFrame, period: str) -> pd.DataFrame:
    if not period or period not in ("1mo", "3mo", "6mo", "1y", "2y", "5y"):
        return ohlcv
    if ohlcv.empty or not hasattr(ohlcv.index, "min"):
        return ohlcv
    end = ohlcv.index.max()
    if period == "1mo":
        start = end - pd.DateOffset(months=1)
    elif period == "3mo":
        start = end - pd.DateOffset(months=3)
    elif period == "6mo":
        start = end - pd.DateOffset(months=6)
    elif period == "1y":
        start = end - pd.DateOffset(years=1)
    elif period == "2y":
        start = end - pd.DateOffset(years=2)
    elif period == "5y":
        start = end - pd.DateOffset(years=5)
    else:
        return ohlcv
    return ohlcv.loc[ohlcv.index >= start]
