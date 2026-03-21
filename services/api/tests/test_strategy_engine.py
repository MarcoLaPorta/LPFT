from __future__ import annotations

import sys
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[2]
for extra in (ROOT / "worker", ROOT / "shared"):
    extra_path = str(extra)
    if extra_path not in sys.path:
        sys.path.append(extra_path)

import pandas as pd

from lpft_api.capabilities import CapabilityStatus, assess_strategy_spec
from lpft_api.assistant import _collect_requirement_snapshot, _requirements_clarification_plan
from lpft_api.schemas import AssistantMessage
from lpft_api.dsl import DataRequirements, StrategySpec
from lpft_api.main import _period_from_spec
from lpft_api.inline_backtest import run_generate_signals as api_run_generate_signals
from lpft_api.program_llm import generate_program
from lpft_shared.engine import (
    ProgramSecurityError,
    build_validation_ohlcv,
    extract_program_metadata,
    run_backtest_from_market_data,
)
from lpft_shared.market_data import (
    DataQualityError,
    DataRequest,
    MarketDataSnapshot,
    build_cache_key,
    fetch_ohlcv_from_provider,
    load_market_data_bundle,
    load_market_data_snapshot,
    resolve_provider_candidates,
    validate_market_data,
)
from lpft_worker.programs import run_generate_signals as worker_run_generate_signals


def _sample_market(length: int = 260) -> pd.DataFrame:
    index = pd.date_range("2024-01-01", periods=length, freq="D", tz="UTC")
    close = pd.Series([100 + step * 0.5 + ((step % 7) - 3) * 0.2 for step in range(length)], index=index, dtype=float)
    open_ = close.shift(1).fillna(close.iloc[0] - 0.3)
    high = pd.concat([open_, close], axis=1).max(axis=1) + 0.4
    low = pd.concat([open_, close], axis=1).min(axis=1) - 0.4
    volume = pd.Series([1_000_000 + (step % 11) * 10_000 for step in range(length)], index=index, dtype=float)
    return pd.DataFrame(
        {
            "open": open_,
            "high": high,
            "low": low,
            "close": close,
            "volume": volume,
        }
    )


class StrategyEngineTests(unittest.TestCase):
    def test_capability_model_blocks_missing_market_data(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "sma_crossover",
                "params": {"fast": 10, "slow": 30, "price": "close"},
                "risk": {"max_position_pct": 0.5},
                "universe": {"symbols": ["AAPL"], "timeframe": "1d"},
                "execution": {"position_mode": "long_only", "rebalance": "equal_weight", "entry_timing": "next_bar_open"},
                "data": {"market_model": "order_book", "requires_intrabar": False},
            }
        )
        report = assess_strategy_spec(spec)
        self.assertEqual(report.status, CapabilityStatus.unsupported_missing_data)
        self.assertTrue(report.missing_requirements)

    def test_capability_model_flags_provider_mismatch(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "sma_crossover",
                "params": {"fast": 10, "slow": 30, "price": "close"},
                "risk": {"max_position_pct": 0.5},
                "universe": {"symbols": ["BTC-USD"], "timeframe": "1d"},
                "execution": {"position_mode": "long_only", "rebalance": "equal_weight", "entry_timing": "next_bar_open"},
                "data": {
                    "market_model": "ohlcv",
                    "requires_intrabar": False,
                    "asset_class": "crypto",
                    "provider_preference": "stooq",
                    "quality_policy": "quality_labels",
                },
            }
        )
        report = assess_strategy_spec(spec)
        self.assertEqual(report.status, CapabilityStatus.unsupported_with_conversion_path)
        self.assertTrue(report.conversion_suggestions)

    def test_generate_program_compiles_builtin_with_metadata(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "ema_crossover",
                "params": {"fast": 12, "slow": 26, "price": "close"},
                "risk": {"max_position_pct": 0.5, "fee_bps": 2, "slippage_bps": 1},
                "universe": {"symbols": ["AAPL", "MSFT"], "timeframe": "1d"},
                "execution": {"position_mode": "long_short", "rebalance": "equal_weight", "entry_timing": "next_bar_open"},
                "data": {"market_model": "ohlcv", "requires_intrabar": False},
            }
        )
        code = generate_program(spec)
        metadata = extract_program_metadata(code)
        self.assertEqual(metadata.strategy_kind, "ema_crossover")
        self.assertEqual(metadata.position_mode, "long_short")
        self.assertEqual(metadata.symbols, ["AAPL", "MSFT"])
        self.assertEqual(metadata.quality_policy, "best_effort")
        self.assertIn("def generate_positions", code)

    def test_data_requirements_default_to_best_effort(self) -> None:
        requirements = DataRequirements()
        self.assertEqual(requirements.quality_policy, "best_effort")

    def test_mean_reversion_params_accept_lookback_period_alias(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "mean_reversion",
                "params": {"lookback_period": 20, "entry_z": 2.0, "exit_z": 0.5},
            }
        )
        self.assertEqual(spec.kind.value, "mean_reversion")
        self.assertEqual(spec.params.period, 20)
        self.assertEqual(spec.params.entry_z, 2.0)
        self.assertEqual(spec.params.exit_z, 0.5)

    def test_mean_reversion_coerces_negative_z_thresholds(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "mean_reversion",
                "params": {"period": 20, "entry_z": -1.5, "exit_z": -0.25},
            }
        )
        self.assertEqual(spec.params.entry_z, 1.5)
        self.assertEqual(spec.params.exit_z, 0.25)

    def test_period_from_spec_prefers_data_history_period(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "sma_crossover",
                "params": {"fast": 5, "slow": 20, "price": "close"},
                "data": {"history_period": "5y"},
            }
        )
        self.assertEqual(_period_from_spec(spec, "1y"), "5y")
        self.assertEqual(_period_from_spec(spec, "1m"), "5y")

    def test_api_and_worker_wrappers_match(self) -> None:
        code = """# LPFT-META: {"artifact_type":"python","capability_status":"supported","capability_summary":"ok","engine_version":"lpft-engine-v2","fee_bps":0.0,"max_gross_exposure":1.0,"max_position_pct":1.0,"position_mode":"long_only","rebalance_mode":"equal_weight","signal_semantics":"target_position","slippage_bps":0.0,"strategy_kind":"python","symbols":["AAPL"],"timeframe":"1d","warnings":[]}
import pandas as pd

def generate_positions(ohlcv: pd.DataFrame) -> pd.Series:
    data = ohlcv.copy()
    fast = sma(data["close"], 5)
    slow = sma(data["close"], 15)
    target = pd.Series(0.0, index=data.index)
    target.loc[(fast > slow) & fast.notna() & slow.notna()] = 1.0
    return target
"""
        ohlcv = build_validation_ohlcv("1d")
        api_positions = api_run_generate_signals(code, ohlcv)
        worker_positions = worker_run_generate_signals(code, ohlcv)
        self.assertTrue(api_positions.equals(worker_positions))

    def test_shared_engine_backtests_multi_symbol_portfolio(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "sma_crossover",
                "params": {"fast": 5, "slow": 20, "price": "close"},
                "risk": {"max_position_pct": 0.8, "max_gross_exposure": 1.0},
                "universe": {"symbols": ["AAPL", "MSFT"], "timeframe": "1d"},
                "execution": {"position_mode": "long_only", "rebalance": "equal_weight", "entry_timing": "next_bar_open"},
                "data": {"market_model": "ohlcv", "requires_intrabar": False},
            }
        )
        code = generate_program(spec)
        market = {
            "AAPL": _sample_market(),
            "MSFT": _sample_market().assign(close=lambda df: df["close"] * 1.02),
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            metrics = run_backtest_from_market_data(market, code, Path(tmpdir))
            self.assertEqual(metrics["symbols_traded"], 2.0)
            self.assertTrue((Path(tmpdir) / "validation.json").is_file())

    def test_python_normalization_accepts_target_position(self) -> None:
        spec = StrategySpec.model_validate(
            {
                "kind": "python",
                "params": {"code": "target_position = (ohlcv['close'] > sma(ohlcv['close'], 10)).astype(float)"},
                "risk": {"max_position_pct": 0.5},
                "universe": {"symbols": ["AAPL"], "timeframe": "1d"},
                "execution": {"position_mode": "long_only", "rebalance": "equal_weight", "entry_timing": "next_bar_open"},
                "data": {"market_model": "ohlcv", "requires_intrabar": False},
            }
        )
        code = generate_program(spec)
        positions = api_run_generate_signals(code, _sample_market())
        self.assertEqual(len(positions), len(_sample_market()))

    def test_runtime_coerces_integer_series_initializers_to_float(self) -> None:
        code = """# LPFT-META: {"artifact_type":"python","capability_status":"supported","capability_summary":"ok","engine_version":"lpft-engine-v2","fee_bps":0.0,"max_gross_exposure":1.0,"max_position_pct":1.0,"position_mode":"long_only","rebalance_mode":"equal_weight","signal_semantics":"target_position","slippage_bps":0.0,"strategy_kind":"python","symbols":["AAPL"],"timeframe":"1d","warnings":[]}
import pandas as pd

def generate_positions(ohlcv: pd.DataFrame) -> pd.Series:
    data = ohlcv.copy()
    signal_strength = (data["close"] / sma(data["close"], 5)).fillna(0.0)
    signals = pd.Series(0, index=data.index)
    valid = signal_strength.notna()
    signals.loc[valid] = signal_strength.loc[valid]
    return signals
"""
        positions = api_run_generate_signals(code, _sample_market())
        self.assertEqual(len(positions), len(_sample_market()))
        self.assertEqual(str(positions.dtype), "float64")

    def test_runtime_surfaces_helpful_error_for_int_series_assignment(self) -> None:
        code = """# LPFT-META: {"artifact_type":"python","capability_status":"supported","capability_summary":"ok","engine_version":"lpft-engine-v2","fee_bps":0.0,"max_gross_exposure":1.0,"max_position_pct":1.0,"position_mode":"long_only","rebalance_mode":"equal_weight","signal_semantics":"target_position","slippage_bps":0.0,"strategy_kind":"python","symbols":["AAPL"],"timeframe":"1d","warnings":[]}
import pandas as pd

def generate_positions(ohlcv: pd.DataFrame) -> pd.Series:
    data = ohlcv.copy()
    signals = pd.Series(0, index=data.index, dtype="int64")
    signals.loc[:] = (data["close"] / sma(data["close"], 5)).fillna(0.0).values
    return signals
"""
        with self.assertRaises(ProgramSecurityError) as ctx:
            api_run_generate_signals(code, _sample_market())
        self.assertIn("Initialize signal or position series with 0.0 instead of 0", str(ctx.exception))

    def test_cache_key_includes_provider_and_asset_class(self) -> None:
        equity_key = build_cache_key(
            DataRequest(symbol="AAPL", period="1y", timeframe="1d", asset_class="equity", provider_preference="auto"),
            "yahoo",
        )
        crypto_key = build_cache_key(
            DataRequest(symbol="BTC-USD", period="1y", timeframe="1d", asset_class="crypto", provider_preference="auto"),
            "yahoo",
        )
        self.assertIn("equity", equity_key)
        self.assertIn("crypto", crypto_key)
        self.assertNotEqual(equity_key, crypto_key)

    def test_validate_market_data_rejects_stale_dataset(self) -> None:
        stale = _sample_market(30)
        stale.index = pd.date_range("2021-01-01", periods=30, freq="D", tz="UTC")
        with self.assertRaises(DataQualityError):
            validate_market_data(
                DataRequest(
                    symbol="AAPL",
                    period="1y",
                    timeframe="1d",
                    asset_class="equity",
                    provider_preference="yahoo",
                    quality_policy="quality_labels",
                    freshness_requirement="strict",
                    coverage_requirement="relaxed",
                ),
                provider_requested="yahoo",
                provider_used="yahoo",
                fetched_at=pd.Timestamp.now(tz="UTC"),
                ohlcv=stale,
            )

    def test_provider_routing_uses_stooq_fallback_for_daily_equity(self) -> None:
        calls: list[str] = []

        def fake_fetch(provider: str, request: DataRequest) -> pd.DataFrame:
            calls.append(provider)
            if provider == "yahoo":
                return pd.DataFrame()
            return _sample_market()

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("lpft_shared.market_data.fetch_ohlcv_from_provider", side_effect=fake_fetch):
                snapshot = load_market_data_snapshot(
                    DataRequest(
                        symbol="SPY",
                        period="1y",
                        timeframe="1d",
                        asset_class="etf",
                        provider_preference="auto",
                        quality_policy="best_effort",
                        freshness_requirement="relaxed",
                        coverage_requirement="relaxed",
                    ),
                    Path(tmpdir),
                )
        self.assertEqual(calls[:2], ["yahoo", "stooq"])
        self.assertEqual(snapshot.provider_used, "stooq")

    def test_resolve_provider_candidates_alpaca_then_yahoo_for_equity(self) -> None:
        cands = resolve_provider_candidates(
            DataRequest(
                symbol="AAPL",
                period="1y",
                timeframe="1d",
                asset_class="equity",
                provider_preference="alpaca",
            )
        )
        self.assertEqual(cands, ["alpaca", "yahoo"])

    def test_resolve_provider_candidates_alpaca_crypto_uses_yahoo_only(self) -> None:
        cands = resolve_provider_candidates(
            DataRequest(
                symbol="BTC-USD",
                period="1y",
                timeframe="1d",
                asset_class="crypto",
                provider_preference="alpaca",
            )
        )
        self.assertEqual(cands, ["yahoo"])

    def test_provider_routing_alpaca_fails_over_to_yahoo(self) -> None:
        calls: list[str] = []

        def fake_fetch(provider: str, request: DataRequest) -> pd.DataFrame:
            calls.append(provider)
            if provider == "alpaca":
                raise ValueError("Alpaca market data requires LPFT_ALPACA_API_KEY and LPFT_ALPACA_SECRET_KEY")
            return _sample_market()

        with tempfile.TemporaryDirectory() as tmpdir:
            with patch("lpft_shared.market_data.fetch_ohlcv_from_provider", side_effect=fake_fetch):
                snapshot = load_market_data_snapshot(
                    DataRequest(
                        symbol="AAPL",
                        period="1y",
                        timeframe="1d",
                        asset_class="equity",
                        provider_preference="alpaca",
                        quality_policy="best_effort",
                        freshness_requirement="relaxed",
                        coverage_requirement="relaxed",
                    ),
                    Path(tmpdir),
                )
        self.assertEqual(calls[:2], ["alpaca", "yahoo"])
        self.assertEqual(snapshot.provider_used, "yahoo")

    def test_fetch_alpaca_parses_bars(self) -> None:
        payload = {
            "bars": {
                "AAPL": [
                    {"t": "2024-01-02T05:00:00Z", "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.5, "v": 1000.0}
                ]
            },
            "next_page_token": None,
        }
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(payload).encode("utf-8")
        mock_cm = MagicMock()
        mock_cm.__enter__.return_value = mock_resp
        mock_cm.__exit__.return_value = False
        with patch.dict(os.environ, {"LPFT_ALPACA_API_KEY": "k", "LPFT_ALPACA_SECRET_KEY": "s"}):
            with patch("lpft_shared.market_data.urllib.request.urlopen", return_value=mock_cm):
                df = fetch_ohlcv_from_provider(
                    "alpaca",
                    DataRequest(
                        symbol="AAPL",
                        period="1y",
                        timeframe="1d",
                        asset_class="equity",
                        provider_preference="alpaca",
                    ),
                )
        self.assertFalse(df.empty)
        self.assertIn("close", df.columns)
        self.assertAlmostEqual(float(df["close"].iloc[-1]), 100.5)

    def test_bundle_quality_gate_blocks_when_one_symbol_fails(self) -> None:
        def fake_snapshot(request: DataRequest, storage_dir: Path):
            if request.symbol == "BROKEN":
                raise DataQualityError({"summary": "Dataset rejected", "status": "rejected", "warnings": []})
            report_request = DataRequest(
                symbol=request.symbol,
                period=request.period,
                timeframe=request.timeframe,
                asset_class=request.asset_class,
                provider_preference=request.provider_preference,
                quality_policy=request.quality_policy,
                freshness_requirement=request.freshness_requirement,
                coverage_requirement=request.coverage_requirement,
                corporate_actions_required=request.corporate_actions_required,
                market=request.market,
            )
            _, report = validate_market_data(
                report_request,
                provider_requested="yahoo",
                provider_used="yahoo",
                fetched_at=pd.Timestamp.now(tz="UTC"),
                ohlcv=_sample_market(),
            )
            return MarketDataSnapshot(
                symbol=request.symbol,
                canonical_symbol=request.symbol,
                asset_class=request.asset_class,
                provider_used="yahoo",
                period=request.period,
                timeframe=request.timeframe,
                ohlcv=_sample_market(),
                quality=report,
            )

        with patch("lpft_shared.market_data.load_market_data_snapshot", side_effect=fake_snapshot):
            with self.assertRaises(DataQualityError):
                load_market_data_bundle(
                    ["AAPL", "BROKEN"],
                    period="1y",
                    timeframe="1d",
                    asset_class="equity",
                    provider_preference="auto",
                    quality_policy="quality_labels",
                    freshness_requirement="standard",
                    coverage_requirement="standard",
                    corporate_actions_required=True,
                    market=None,
                    storage_dir=Path("/tmp"),
                )

    def test_requirement_clarification_plan_requests_missing_inputs(self) -> None:
        plan = _requirements_clarification_plan(
            mode="generate",
            messages=[AssistantMessage(role="user", content="Crea una strategia vincente")],
            latest_user="Crea una strategia vincente",
            current_code=None,
            current_spec=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.mode, "clarify")
        self.assertTrue(plan.clarification_options)

    def test_requirement_snapshot_tracks_confirmed_inputs(self) -> None:
        snapshot = _collect_requirement_snapshot(
            [
                AssistantMessage(
                    role="user",
                    content="Voglio una strategia trend su AAPL per azioni USA, daily, profilo bilanciato, backtest su 5y. Procedi con la generazione."
                )
            ],
            current_spec=None,
        )
        self.assertEqual(snapshot.instrument, "AAPL")
        self.assertEqual(snapshot.universe, "equity")
        self.assertEqual(snapshot.edge, "trend or momentum")
        self.assertEqual(snapshot.timeframe, "daily or position")
        self.assertEqual(snapshot.risk, "balanced")
        self.assertTrue(snapshot.ready_for_generation)
        self.assertTrue(snapshot.user_approved)
        self.assertEqual(snapshot.backtest_window, "5y")

    def test_requirement_clarification_plan_requests_instrument_first(self) -> None:
        messages = [
            AssistantMessage(
                role="user",
                content="Crea una strategia trend per ETF, daily, rischio bilanciato"
            )
        ]
        plan = _requirements_clarification_plan(
            mode="generate",
            messages=messages,
            latest_user=messages[-1].content,
            current_code=None,
            current_spec=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.mode, "clarify")
        self.assertIn("strumento", plan.clarification_question.lower())
        self.assertIn("SPY", plan.clarification_options or [])

    def test_requirement_clarification_plan_requests_final_confirmation(self) -> None:
        messages = [
            AssistantMessage(
                role="user",
                content="Crea una strategia trend su SPY per ETF, daily, rischio bilanciato, backtest su 5 anni"
            )
        ]
        plan = _requirements_clarification_plan(
            mode="generate",
            messages=messages,
            latest_user=messages[-1].content,
            current_code=None,
            current_spec=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.mode, "clarify")
        self.assertTrue(plan.clarification_summary)
        self.assertIn("Procedi con la generazione", plan.clarification_options or [])

    def test_requirement_clarification_plan_requests_backtest_window_when_needed(self) -> None:
        messages = [
            AssistantMessage(
                role="user",
                content="Strategia mean reversion su MSFT azioni USA daily rischio bilanciato, esegui backtest",
            )
        ]
        plan = _requirements_clarification_plan(
            mode="generate",
            messages=messages,
            latest_user=messages[-1].content,
            current_code=None,
            current_spec=None,
        )
        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.mode, "clarify")
        q = (plan.clarification_question or "").lower()
        self.assertTrue("storico" in q or "history" in q)
        opts = plan.clarification_options or []
        self.assertTrue(any("5y" in o or "Recommended" in o or "Consigliato" in o for o in opts))


if __name__ == "__main__":
    unittest.main()
