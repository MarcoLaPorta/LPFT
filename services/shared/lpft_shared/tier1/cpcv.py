"""Combinatorial Purged Cross-Validation (CPCV) — simplified Lopez de Prado."""

from __future__ import annotations

import itertools
import math
from typing import Sequence

import numpy as np

from .dsr import sharpe_ratio


def _purge_train_indices(
    n: int,
    test_idx: np.ndarray,
    embargo: int,
) -> np.ndarray:
    test_set = set(int(i) for i in test_idx)
    train = []
    test_start = int(test_idx.min()) if test_idx.size else 0
    test_end = int(test_idx.max()) if test_idx.size else 0
    for i in range(n):
        if i in test_set:
            continue
        # Purge train samples in embargo window after test block start
        if test_start <= i <= test_end + embargo:
            continue
        train.append(i)
    return np.array(train, dtype=int)


def combinatorial_purged_cv(
    returns: Sequence[float],
    *,
    n_groups: int = 6,
    n_test_groups: int = 2,
    embargo_pct: float = 0.01,
    max_folds: int = 20,
    periods_per_year: float = 252.0,
) -> dict:
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    n = int(r.size)
    if n < n_groups * 5:
        return {
            "n_folds": 0,
            "sharpe_mean": 0.0,
            "sharpe_std": 0.0,
            "sharpe_min": 0.0,
            "sharpe_max": 0.0,
            "fold_sharpes": [],
            "n_groups": n_groups,
            "n_test_groups": n_test_groups,
        }

    n_groups = max(2, min(n_groups, n // 5))
    n_test_groups = max(1, min(n_test_groups, n_groups - 1))
    group_size = n // n_groups
    groups = []
    for g in range(n_groups):
        start = g * group_size
        end = n if g == n_groups - 1 else (g + 1) * group_size
        groups.append(np.arange(start, end, dtype=int))

    embargo = max(1, int(n * embargo_pct))
    combos = list(itertools.combinations(range(n_groups), n_test_groups))
    if len(combos) > max_folds:
        combos = combos[:max_folds]

    fold_sharpes: list[float] = []
    for test_group_ids in combos:
        test_idx = np.concatenate([groups[i] for i in test_group_ids])
        train_idx = _purge_train_indices(n, test_idx, embargo)
        if train_idx.size < 10:
            continue
        sr = sharpe_ratio(r[train_idx], periods_per_year=periods_per_year)
        if math.isfinite(sr):
            fold_sharpes.append(sr)

    if not fold_sharpes:
        return {
            "n_folds": 0,
            "sharpe_mean": 0.0,
            "sharpe_std": 0.0,
            "sharpe_min": 0.0,
            "sharpe_max": 0.0,
            "fold_sharpes": [],
            "n_groups": n_groups,
            "n_test_groups": n_test_groups,
        }

    arr = np.array(fold_sharpes, dtype=float)
    return {
        "n_folds": int(arr.size),
        "sharpe_mean": float(np.mean(arr)),
        "sharpe_std": float(np.std(arr, ddof=1)) if arr.size > 1 else 0.0,
        "sharpe_min": float(np.min(arr)),
        "sharpe_max": float(np.max(arr)),
        "fold_sharpes": [float(x) for x in arr],
        "n_groups": n_groups,
        "n_test_groups": n_test_groups,
        "embargo_bars": embargo,
    }
