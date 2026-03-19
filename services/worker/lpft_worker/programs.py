from __future__ import annotations

import pandas as pd

from lpft_shared.engine import ProgramSecurityError, run_generate_positions


def run_generate_signals(code: str, ohlcv: pd.DataFrame) -> pd.Series:
    return run_generate_positions(code, ohlcv)
