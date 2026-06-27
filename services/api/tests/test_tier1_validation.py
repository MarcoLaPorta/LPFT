from __future__ import annotations

import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SHARED = ROOT / "shared"
TIER1_DIR = SHARED / "lpft_shared" / "tier1"
if str(SHARED) not in sys.path:
    sys.path.insert(0, str(SHARED))

# Stub package lpft_shared per evitare import engine/pandas in CI leggero.
import importlib
import types

if "lpft_shared" not in sys.modules:
    _pkg = types.ModuleType("lpft_shared")
    _pkg.__path__ = [str(SHARED / "lpft_shared")]
    sys.modules["lpft_shared"] = _pkg
if "lpft_shared.tier1" not in sys.modules:
    _t1 = types.ModuleType("lpft_shared.tier1")
    _t1.__path__ = [str(TIER1_DIR)]
    sys.modules["lpft_shared.tier1"] = _t1

_tier1_dsr = importlib.import_module("lpft_shared.tier1.dsr")
_tier1_cvar = importlib.import_module("lpft_shared.tier1.cvar")
_tier1_ffd = importlib.import_module("lpft_shared.tier1.fractional_diff")
_tier1_mc = importlib.import_module("lpft_shared.tier1.monte_carlo")
_tier1_cpcv = importlib.import_module("lpft_shared.tier1.cpcv")
_tier1_pipeline = importlib.import_module("lpft_shared.tier1.pipeline")

combinatorial_purged_cv = _tier1_cpcv.combinatorial_purged_cv
deflated_sharpe_ratio = _tier1_dsr.deflated_sharpe_ratio
sharpe_ratio = _tier1_dsr.sharpe_ratio
frac_diff_ffd = _tier1_ffd.frac_diff_ffd
simulate_terminal_returns = _tier1_mc.simulate_terminal_returns
run_tier1_validation = _tier1_pipeline.run_tier1_validation


class Tier1ValidationTests(unittest.TestCase):
    def _sample_returns(self, n: int = 300) -> np.ndarray:
        rng = np.random.default_rng(7)
        return rng.normal(0.0004, 0.01, size=n)

    def test_frac_diff_produces_finite_series(self):
        prices = np.cumprod(1 + self._sample_returns(200))
        diffed = frac_diff_ffd(prices, d=0.4)
        self.assertGreater(diffed.size, 50)
        self.assertTrue(np.all(np.isfinite(diffed)))

    def test_dsr_in_unit_interval(self):
        r = self._sample_returns(400)
        out = deflated_sharpe_ratio(r, n_trials=10)
        self.assertGreaterEqual(out["dsr"], 0.0)
        self.assertLessEqual(out["dsr"], 1.0)
        self.assertTrue(np.isfinite(out["observed_sharpe"]))

    def test_cpcv_multiple_folds(self):
        r = self._sample_returns(360)
        out = combinatorial_purged_cv(r, n_groups=6, n_test_groups=2, max_folds=10)
        self.assertGreater(out["n_folds"], 0)
        self.assertTrue(np.isfinite(out["sharpe_mean"]))

    def test_monte_carlo_10k_paths(self):
        r = self._sample_returns(252)
        out = simulate_terminal_returns(r, horizon_days=30, n_paths=10_000, seed=1)
        self.assertEqual(out["n_paths"], 10_000)
        self.assertLess(out["terminal_return_p5"], out["terminal_return_p95"])

    def test_pipeline_full(self):
        r = self._sample_returns(500)
        equity = np.cumprod(1 + r)
        out = run_tier1_validation(equity=equity.tolist(), n_trials=5, mc_paths=1000)
        self.assertEqual(out["version"], "tier1-v1")
        self.assertGreater(out["n_observations"], 100)
        self.assertIn("cpcv", out)
        self.assertIn("monte_carlo", out)
        self.assertAlmostEqual(sharpe_ratio(r), out["sharpe"], places=2)


if __name__ == "__main__":
    unittest.main()
