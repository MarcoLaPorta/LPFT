"""Deflated Sharpe Ratio (Bailey & Lopez de Prado)."""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np

_EULER = 0.5772156649015329


def _norm_cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _norm_ppf(p: float) -> float:
    """Approximate inverse CDF (Acklam) — no scipy dependency."""
    if p <= 0:
        return -10.0
    if p >= 1:
        return 10.0
    a = [
        -3.969683028665376e01,
        2.209460984245205e02,
        -2.759285104469138e02,
        1.383577518672690e02,
        -3.066479806614716e01,
        2.506628277459239e00,
    ]
    b = [
        -5.447609879822406e01,
        1.615858368580409e02,
        -1.556989812400845e02,
        6.680131188771972e01,
        -1.328068155288572e01,
    ]
    c = [
        -7.784894002430293e-03,
        -3.224671290700397e-01,
        -2.400758277161838e00,
        -2.549539603230730e00,
        4.374664141464968e00,
        2.938163982698783e00,
    ]
    d = [
        7.784695709091636e-03,
        3.224671290700397e-01,
        2.445134137142996e00,
        3.754408661907416e00,
    ]
    plow = 0.02425
    phigh = 1 - plow
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
            / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
        )
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(
            (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
            / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
        )
    q = p - 0.5
    r = q * q
    return (
        (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
        / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    )


def expected_max_sharpe(n_trials: int, n_observations: int) -> float:
    """Expected maximum Sharpe under null for n independent trials."""
    if n_trials <= 1 or n_observations < 2:
        return 0.0
    z1 = _norm_ppf(1.0 - 1.0 / n_trials)
    z2 = _norm_ppf(1.0 - 1.0 / (n_trials * math.e))
    emax = (1.0 - _EULER) * z1 + _EULER * z2
    return emax / math.sqrt(n_observations)


def sharpe_ratio(returns: Sequence[float], periods_per_year: float = 252.0) -> float:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if r.size < 2:
        return 0.0
    mu = float(np.mean(r))
    sigma = float(np.std(r, ddof=1))
    if sigma <= 1e-12:
        return 0.0
    return (mu / sigma) * math.sqrt(periods_per_year)


def deflated_sharpe_ratio(
    returns: Sequence[float],
    *,
    n_trials: int = 1,
    periods_per_year: float = 252.0,
    sr_benchmark: float = 0.0,
) -> dict:
    """
  Returns DSR as probability that true Sharpe exceeds benchmark after multiple-testing adjustment.
  """
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    n = int(r.size)
    if n < 3:
        return {
            "observed_sharpe": 0.0,
            "dsr": 0.0,
            "expected_max_sharpe": 0.0,
            "n_observations": n,
            "n_trials": n_trials,
            "skew": 0.0,
            "kurtosis": 3.0,
        }

    sr = sharpe_ratio(r, periods_per_year=periods_per_year)
    skew = float(np.mean(((r - np.mean(r)) / (np.std(r, ddof=1) or 1e-12)) ** 3))
    kurt = float(np.mean(((r - np.mean(r)) / (np.std(r, ddof=1) or 1e-12)) ** 4))
    var_sr = (1.0 - skew * sr + ((kurt - 1.0) / 4.0) * sr * sr) / max(n - 1, 1)
    emax = expected_max_sharpe(max(n_trials, 1), n)
    denom = math.sqrt(max(var_sr, 1e-12))
    z = (sr - sr_benchmark - emax) / denom
    dsr = _norm_cdf(z)

    return {
        "observed_sharpe": sr,
        "dsr": dsr,
        "expected_max_sharpe": emax,
        "n_observations": n,
        "n_trials": n_trials,
        "skew": skew,
        "kurtosis": kurt,
    }
