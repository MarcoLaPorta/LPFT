from __future__ import annotations

from pathlib import Path

import pandas as pd

from lpft_shared.engine import (
    ProgramSecurityError,
    extract_program_metadata,
    run_backtest_from_market_data,
    run_generate_positions,
)
from lpft_shared.market_data import DataQualityError, load_market_data_bundle


def run_generate_signals(code: str, ohlcv: pd.DataFrame) -> pd.Series:
    return run_generate_positions(code, ohlcv)

def run_inline_backtest(
    *,
    symbol: str,
    period: str,
    timeframe: str,
    program_code: str,
    output_dir: Path,
    initial_equity: float = 10_000.0,
    storage_dir: Path | None = None,
) -> dict[str, float]:
    metadata = extract_program_metadata(program_code)
    symbols = metadata.symbols or [symbol or "AAPL"]
    if storage_dir is None:
        storage_dir = Path(output_dir).resolve().parents[1]
    market_data = load_market_data_bundle(
        symbols,
        period=period,
        timeframe=timeframe,
        asset_class=metadata.asset_class,
        provider_preference=metadata.provider_preference,
        quality_policy=metadata.quality_policy,
        freshness_requirement=metadata.freshness_requirement,
        coverage_requirement=metadata.coverage_requirement,
        corporate_actions_required=metadata.corporate_actions_required,
        market=metadata.market,
        storage_dir=Path(storage_dir),
    )
    return run_backtest_from_market_data(
        market_data,
        program_code,
        Path(output_dir),
        initial_equity=initial_equity,
    )

