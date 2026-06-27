"""VaR / CVaR (Expected Shortfall) on return samples."""

from __future__ import annotations

from typing import Sequence

import numpy as np


def historical_var_cvar(
    returns: Sequence[float],
    alpha: float = 0.05,
) -> dict:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if r.size == 0:
        return {"var": 0.0, "cvar": 0.0, "alpha": alpha, "n": 0}
    q = float(np.quantile(r, alpha))
    tail = r[r <= q]
    cvar = float(np.mean(tail)) if tail.size > 0 else q
    return {
        "var": q,
        "cvar": cvar,
        "alpha": alpha,
        "n": int(r.size),
    }
