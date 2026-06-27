"""Monte Carlo path simulation (default 10k paths) on log-returns."""

from __future__ import annotations

from typing import Sequence

import numpy as np


def simulate_terminal_returns(
    returns: Sequence[float],
    *,
    horizon_days: int = 30,
    n_paths: int = 10_000,
    seed: int | None = 42,
) -> dict:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if r.size < 5:
        return {
            "n_paths": 0,
            "horizon_days": horizon_days,
            "terminal_return_p5": 0.0,
            "terminal_return_p50": 0.0,
            "terminal_return_p95": 0.0,
            "terminal_return_mean": 0.0,
            "cvar_95": 0.0,
            "var_95": 0.0,
        }

    rng = np.random.default_rng(seed)
    mu = float(np.mean(r))
    sigma = float(np.std(r, ddof=1)) or 1e-8
    n_paths = int(min(max(n_paths, 100), 20_000))
    horizon_days = int(max(horizon_days, 1))

    # Bootstrap + Gaussian innovation blend for stability
    idx = rng.integers(0, r.size, size=(n_paths, horizon_days))
    boot = r[idx]
    noise = rng.normal(0.0, sigma * 0.15, size=(n_paths, horizon_days))
    daily = boot + noise
    log_cum = np.sum(np.log1p(np.clip(daily, -0.99, None)), axis=1)
    terminals = np.expm1(log_cum)

    p5, p50, p95 = [float(x) for x in np.quantile(terminals, [0.05, 0.5, 0.95])]
    var_95 = float(np.quantile(terminals, 0.05))
    tail = terminals[terminals <= var_95]
    cvar_95 = float(np.mean(tail)) if tail.size > 0 else var_95

    return {
        "n_paths": n_paths,
        "horizon_days": horizon_days,
        "terminal_return_p5": p5,
        "terminal_return_p50": p50,
        "terminal_return_p95": p95,
        "terminal_return_mean": float(np.mean(terminals)),
        "var_95": var_95,
        "cvar_95": cvar_95,
        "drift_daily": mu,
        "vol_daily": sigma,
    }
