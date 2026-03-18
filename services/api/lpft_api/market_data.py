from __future__ import annotations

from pathlib import Path

import pandas as pd
import yfinance as yf

from lpft_api.config import settings

VALID_TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "1d")


def dataset_path(filename: str) -> Path:
    return Path(settings.storage_dir) / "datasets" / filename


def fetch_ohlcv_yahoo(
    symbol: str,
    period: str = "1y",
    interval: str = "1d",
) -> pd.DataFrame:
    ticker = yf.Ticker(symbol)
    df = ticker.history(period=period, interval=interval)
    if df.empty:
        return df
    df = df.rename(columns={
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume",
    })
    df = df[["open", "high", "low", "close", "volume"]].dropna()
    df.index.name = "datetime"
    return df
