"""Fixed-width window fractional differentiation (FFD), Lopez de Prado style."""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np


def frac_diff_weights(d: float, threshold: float = 1e-4, max_len: int = 120) -> np.ndarray:
    """Weights w_k for fractional differentiation order d."""
    if d < 0 or d > 1:
        raise ValueError("d must be in [0, 1]")
    weights = [1.0]
    k = 1
    while k < max_len:
        w_k = -weights[-1] * (d - k + 1) / k
        if abs(w_k) < threshold:
            break
        weights.append(w_k)
        k += 1
    return np.array(weights[::-1], dtype=float)


def frac_diff_ffd(series: Sequence[float], d: float = 0.4, threshold: float = 1e-5) -> np.ndarray:
    """Apply FFD; returns differentiated series (drops initial warm-up window)."""
    x = np.asarray(series, dtype=float).reshape(-1)
    if x.size < 3:
        return x.copy()
    w = frac_diff_weights(d, threshold=threshold)
    if w.size > max(10, x.size - 2):
        w = w[-max(10, x.size - 2) :]
    width = int(len(w))
    if x.size < width:
        return np.array([], dtype=float)
    out: list[float] = []
    for i in range(width - 1, x.size):
        window = x[i - width + 1 : i + 1]
        if not np.all(np.isfinite(window)):
            continue
        out.append(float(np.dot(w, window)))
    return np.asarray(out, dtype=float)


def frac_diff_summary(series: Sequence[float], d: float = 0.4) -> dict:
    diffed = frac_diff_ffd(series, d=d)
    if diffed.size == 0:
        return {"d": d, "n_weights": 0, "n_obs": 0, "last": None, "std": None}
    w = frac_diff_weights(d)
    return {
        "d": d,
        "n_weights": int(len(w)),
        "n_obs": int(diffed.size),
        "last": float(diffed[-1]),
        "std": float(np.std(diffed, ddof=1)) if diffed.size > 1 else 0.0,
    }
