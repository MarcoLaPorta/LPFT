from __future__ import annotations

from pathlib import Path

import pandas as pd

from lpft_shared.engine import run_backtest_from_market_data


def run_backtest(
    ohlcv: pd.DataFrame,
    program_code: str,
    output_dir: Path,
) -> dict:
    return run_backtest_from_market_data({"default": ohlcv}, program_code, Path(output_dir))
