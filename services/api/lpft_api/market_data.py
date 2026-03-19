from __future__ import annotations

from pathlib import Path

import pandas as pd

from lpft_api.config import settings
from lpft_shared.market_data import (
    DataRequest,
    dataset_path as shared_dataset_path,
    load_market_data_snapshot,
)

VALID_TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "1d")


def dataset_path(filename: str) -> Path:
    return shared_dataset_path(Path(settings.storage_dir), filename)


def fetch_ohlcv_yahoo(
    symbol: str,
    period: str = "1y",
    interval: str = "1d",
) -> pd.DataFrame:
    snapshot = load_market_data_snapshot(
        DataRequest(
            symbol=symbol,
            period=period,
            timeframe=interval,
            asset_class="crypto" if str(symbol).upper().endswith("-USD") else "equity",
            provider_preference="yahoo",
            quality_policy="best_effort",
            freshness_requirement="relaxed",
            coverage_requirement="relaxed",
        ),
        Path(settings.storage_dir),
    )
    return snapshot.ohlcv.copy()
