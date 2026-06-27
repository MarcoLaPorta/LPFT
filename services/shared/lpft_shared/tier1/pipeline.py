"""Tier 1 Phase 2 validation pipeline — heavy quant (Python only)."""

from __future__ import annotations

from typing import Sequence

import numpy as np

from .cpcv import combinatorial_purged_cv
from .cvar import historical_var_cvar
from .dsr import deflated_sharpe_ratio, sharpe_ratio
from .fractional_diff import frac_diff_summary
from .monte_carlo import simulate_terminal_returns

TIER1_VALIDATION_VERSION = "tier1-v1"


def equity_to_returns(equity: Sequence[float]) -> np.ndarray:
    e = np.asarray(equity, dtype=float)
    e = e[np.isfinite(e) & (e > 0)]
    if e.size < 2:
        return np.array([], dtype=float)
    return np.diff(e) / e[:-1]


def run_tier1_validation(
    *,
    equity: Sequence[float] | None = None,
    returns: Sequence[float] | None = None,
    n_trials: int = 1,
    mc_paths: int = 10_000,
    mc_horizon_days: int = 30,
    ffd_d: float = 0.4,
    cpcv_n_groups: int = 6,
    cpcv_n_test_groups: int = 2,
    periods_per_year: float = 252.0,
) -> dict:
    if returns is not None:
        r = np.asarray(returns, dtype=float)
    elif equity is not None:
        r = equity_to_returns(equity)
    else:
        raise ValueError("Provide equity or returns")

    r = r[np.isfinite(r)]
    n = int(r.size)
    if n < 10:
        raise ValueError(f"Need at least 10 return observations, got {n}")

    closes = None
    if equity is not None:
        closes = np.asarray(equity, dtype=float)
        closes = closes[np.isfinite(closes) & (closes > 0)]

    sr = sharpe_ratio(r, periods_per_year=periods_per_year)
    dsr_out = deflated_sharpe_ratio(
        r,
        n_trials=max(1, n_trials),
        periods_per_year=periods_per_year,
    )
    tail = historical_var_cvar(r, alpha=0.05)
    cpcv = combinatorial_purged_cv(
        r,
        n_groups=cpcv_n_groups,
        n_test_groups=cpcv_n_test_groups,
        periods_per_year=periods_per_year,
    )
    mc = simulate_terminal_returns(
        r,
        horizon_days=mc_horizon_days,
        n_paths=mc_paths,
    )
    ffd = frac_diff_summary(closes if closes is not None and closes.size >= 10 else np.cumprod(1 + r), d=ffd_d)

    return {
        "version": TIER1_VALIDATION_VERSION,
        "n_observations": n,
        "sharpe": sr,
        "dsr": dsr_out,
        "cvar": {
            "historical": tail,
            "monte_carlo": {"var_95": mc["var_95"], "cvar_95": mc["cvar_95"]},
        },
        "cpcv": cpcv,
        "fractional_diff": ffd,
        "monte_carlo": mc,
    }
