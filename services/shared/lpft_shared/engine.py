from __future__ import annotations

import json
import math
import os
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from lpft_shared.market_data import MarketDataSnapshot

ENGINE_VERSION = "lpft-engine-v3"
_META_PREFIX = "# LPFT-META: "
_INT_SERIES_INIT_RE = re.compile(r"(\b(?:pd|pandas)\.Series\(\s*)(-?1|0|1)(\s*,)")
_TRADE_COLUMNS = [
    "symbol",
    "side",
    "entry_time",
    "exit_time",
    "entry_price",
    "exit_price",
    "pnl_pct",
    "pnl",
    "execution",
]


class ProgramSecurityError(Exception):
    pass


@dataclass
class ProgramMetadata:
    engine_version: str = ENGINE_VERSION
    strategy_kind: str = "python"
    artifact_type: str = "python"
    position_mode: str = "long_only"
    signal_semantics: str = "legacy_events"
    symbols: list[str] = field(default_factory=lambda: ["AAPL"])
    timeframe: str = "1d"
    max_position_pct: float = 1.0
    max_gross_exposure: float = 1.0
    stop_loss_pct: float | None = None
    take_profit_pct: float | None = None
    trailing_stop_pct: float | None = None
    fee_bps: float = 0.0
    slippage_bps: float = 0.0
    rebalance_mode: str = "equal_weight"
    capability_status: str = "supported"
    capability_summary: str = "Compatible with the shared OHLCV engine."
    warnings: list[str] = field(default_factory=list)
    asset_class: str = "equity"
    provider_preference: str = "auto"
    quality_policy: str = "best_effort"
    freshness_requirement: str = "standard"
    coverage_requirement: str = "standard"
    corporate_actions_required: bool = False
    market: str | None = None
    # Mirrors StrategySpec.execution.entry_timing (see run_backtest_from_market_data).
    entry_timing: str = "next_bar_open"
    # Advanced execution simulator controls (OHLCV-based approximation).
    execution_latency_bars: int = 0
    max_participation_rate: float = 0.1
    min_bar_notional: float = 50_000.0
    spread_bps_base: float = 1.0
    spread_bps_range_factor: float = 0.15
    impact_bps_coeff: float = 10.0
    quote_imbalance_sensitivity: float = 0.2
    quote_reversion_to_mid: float = 0.3
    # Annualized borrow / stock loan fee on short notional (long_short only); applied per bar pro-rata.
    borrow_bps: float = 0.0
    # Oracle / block delay + spread tipico DEX (mock o da LPFT-META); default 0 = solo equity Web2.
    onchain_latency_bars: int = 0
    dex_synthetic_spread_bps: float = 0.0

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "ProgramMetadata":
        if not isinstance(payload, dict):
            return cls()
        data = dict(payload)
        if not isinstance(data.get("symbols"), list) or not data["symbols"]:
            data["symbols"] = ["AAPL"]
        data["symbols"] = [str(symbol).strip().upper() for symbol in data["symbols"] if str(symbol).strip()]
        data["warnings"] = [str(item).strip() for item in data.get("warnings", []) if str(item).strip()]
        return cls(**{key: value for key, value in data.items() if key in cls.__dataclass_fields__})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def embed_program_metadata(code: str, metadata: ProgramMetadata) -> str:
    payload = json.dumps(metadata.to_dict(), sort_keys=True)
    stripped = code.lstrip()
    if stripped.startswith(_META_PREFIX):
        lines = code.splitlines()
        lines[0] = f"{_META_PREFIX}{payload}"
        return "\n".join(lines)
    return f"{_META_PREFIX}{payload}\n{code}"


def extract_program_metadata(code: str) -> ProgramMetadata:
    first_line = code.strip().splitlines()[0] if code.strip() else ""
    if first_line.startswith(_META_PREFIX):
        raw = first_line[len(_META_PREFIX) :].strip()
        try:
            return ProgramMetadata.from_dict(json.loads(raw))
        except Exception:
            return ProgramMetadata()
    return ProgramMetadata()


def _coerce_common_series_initializers(code: str) -> str:
    # Pandas infers int64 from patterns like pd.Series(0, index=...).
    # Many generated/user strategies then assign float values into that series,
    # which raises "Invalid value ... for dtype 'int64'" on newer pandas.
    return _INT_SERIES_INIT_RE.sub(r"\g<1>\g<2>.0\g<3>", code)


def _strip_metadata_header(code: str) -> str:
    lines = code.splitlines()
    if lines and lines[0].startswith(_META_PREFIX):
        return "\n".join(lines[1:])
    return code


def _safe_import(name: str, globals=None, locals=None, fromlist=(), level=0):
    allow = {"pandas", "pd", "numpy", "np"}
    if name not in allow and not (fromlist and all(f in allow for f in fromlist)):
        raise ProgramSecurityError(f"Import not allowed: {name}")
    return __import__(name, globals, locals, fromlist, level)


def validate_python(code: str) -> None:
    lowered = code.lower()
    if "subprocess" in lowered or "socket" in lowered or "requests" in lowered:
        raise ProgramSecurityError("Disallowed operations")
    if "import os" in lowered or "import sys" in lowered:
        raise ProgramSecurityError("Disallowed operations")
    unsupported_patterns = {
        "bid-ask spread": "Unsupported strategy logic for OHLCV backtests",
        "market making": "Unsupported strategy logic for OHLCV backtests",
        "order book": "Unsupported strategy logic for OHLCV backtests",
        "queue position": "Unsupported strategy logic for OHLCV backtests",
        "maker rebate": "Unsupported strategy logic for OHLCV backtests",
        "data.index %": "Unsupported index arithmetic in generated strategy",
        "position_proxy": "Unsupported synthetic inventory logic in generated strategy",
    }
    for needle, message in unsupported_patterns.items():
        if needle in lowered:
            raise ProgramSecurityError(message)


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, float("nan"))
    return 100 - (100 / (1 + rs))


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    ema_fast = ema(series, fast)
    ema_slow = ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = ema(macd_line, signal)
    return macd_line, signal_line


def macd_hist(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.Series:
    macd_line, signal_line = macd(series, fast, slow, signal)
    return macd_line - signal_line


def bollinger_bands(series: pd.Series, period: int = 20, std: float = 2.0):
    mid = series.rolling(period).mean()
    std_ = series.rolling(period).std()
    upper = mid + std * std_
    lower = mid - std * std_
    return upper, mid, lower


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.rolling(period).mean()


def _periods_per_year_from_index(index: pd.DatetimeIndex) -> float:
    """Annualization factor for Sharpe from bar spacing (median delta)."""
    if len(index) < 2:
        return 252.0
    deltas = pd.Series(index).diff().dropna()
    if deltas.empty:
        return 252.0
    med = deltas.median()
    try:
        seconds = float(med.total_seconds())
    except (AttributeError, TypeError, ValueError):
        return 252.0
    if seconds <= 0:
        return 252.0
    sec_per_year = 365.25 * 24 * 3600
    return min(max(sec_per_year / seconds, 1.0), 1_000_000.0)


def _sanitize_rate(fee_bps: float, slippage_bps: float) -> float:
    return float(fee_bps + slippage_bps) / 10_000.0


def _short_exposure_fraction(position_df: pd.DataFrame) -> pd.Series:
    """Sum of absolute short weights per bar (for borrow drag)."""
    if position_df is None or position_df.empty:
        return pd.Series(dtype=float)
    return position_df.clip(upper=0.0).abs().sum(axis=1).astype(float)


def _borrow_drag_fraction_per_bar(
    position_df: pd.DataFrame,
    borrow_bps: float,
    periods_per_year: float,
    *,
    position_mode: str,
) -> pd.Series:
    """Pro-rata per-bar fraction of equity charged on short notional (annual borrow_bps)."""
    idx = position_df.index
    if str(position_mode).lower().strip() != "long_short" or borrow_bps <= 0 or periods_per_year <= 0:
        return pd.Series(0.0, index=idx, dtype=float)
    short_exp = _short_exposure_fraction(position_df)
    return (short_exp * (float(borrow_bps) / 10_000.0) / float(periods_per_year)).astype(float)


def _clip_portfolio_returns(ret: pd.Series) -> pd.Series:
    lo = float(os.getenv("LPFT_ENGINE_RETURN_CLIP_MIN", "-0.95") or "-0.95")
    hi = float(os.getenv("LPFT_ENGINE_RETURN_CLIP_MAX", "10.0") or "10.0")
    return ret.clip(lo, hi)


def _compute_advanced_metrics(
    returns: pd.Series,
    equity_series: pd.Series,
    periods_per_year: float,
    trade_rows: list[dict[str, Any]],
) -> dict[str, float]:
    """Calmar, Sortino, profit factor, consecutive loss streak (from bar returns / trades)."""
    out: dict[str, float] = {
        "calmar_ratio": 0.0,
        "sortino_ratio": 0.0,
        "profit_factor": 0.0,
        "max_consecutive_loss_bars": 0.0,
    }
    if len(equity_series) > 1:
        total_ret = float(equity_series.iloc[-1] / equity_series.iloc[0] - 1.0)
        peak = equity_series.cummax()
        dd = (equity_series / peak - 1.0).fillna(0.0)
        max_dd = float(dd.min())
        if max_dd < -1e-12:
            out["calmar_ratio"] = float(total_ret / abs(max_dd))

    downside = returns.copy()
    downside = downside.where(downside < 0.0, 0.0)
    dstd = float(downside.std(ddof=0))
    mean = float(returns.mean()) if len(returns) else 0.0
    if dstd > 0:
        out["sortino_ratio"] = float(mean / dstd * math.sqrt(periods_per_year))

    if trade_rows:
        wins = sum(float(r["pnl"]) for r in trade_rows if float(r.get("pnl", 0)) > 0)
        losses = sum(float(r["pnl"]) for r in trade_rows if float(r.get("pnl", 0)) < 0)
        if losses < 0:
            out["profit_factor"] = float(wins / abs(losses))
        elif wins > 0 and losses == 0:
            out["profit_factor"] = 1_000_000.0

    streak = 0
    max_streak = 0
    for r in returns.fillna(0.0).iloc[1:]:
        if float(r) < 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
    out["max_consecutive_loss_bars"] = float(max_streak)

    return out


def _run_engine_quality_checks(
    equity_series: pd.Series,
    portfolio_returns: pd.Series,
    execution_cost: pd.Series,
) -> dict[str, Any]:
    issues: list[str] = []
    if len(equity_series) and float(equity_series.min()) < 0:
        issues.append("equity_series_contains_non_positive_values")
    if len(portfolio_returns) and not portfolio_returns.replace([float("inf"), float("-inf")], 0.0).notna().all():
        issues.append("portfolio_returns_has_nan_or_inf")
    ec = float(execution_cost.sum()) if len(execution_cost) else 0.0
    if ec < 0:
        issues.append("negative_cumulative_execution_cost")
    return {"status": "ok" if not issues else "warn", "issues": issues}


def _portfolio_returns_bar_close(
    position_df: pd.DataFrame,
    close_df: pd.DataFrame,
    rate: float,
) -> pd.Series:
    returns_df = (close_df / close_df.shift(1) - 1.0).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    prev_position_df = position_df.shift(1).fillna(0.0)
    turnover = (position_df - prev_position_df).abs().sum(axis=1)
    transaction_cost = turnover * rate
    return (prev_position_df * returns_df).sum(axis=1) - transaction_cost


def _portfolio_returns_next_bar_open(
    position_df: pd.DataFrame,
    close_df: pd.DataFrame,
    open_df: pd.DataFrame,
    rate: float,
) -> pd.Series:
    """Two-segment return: signal at close j-1 fills at open j; hold raw[j-2] from close[j-1] to open[j], raw[j-1] from open[j] to close[j]."""
    open_df = open_df.reindex(close_df.index).astype(float)
    open_df = open_df.where(open_df.notna() & (open_df > 0), close_df)
    oc = (open_df / close_df.shift(1) - 1.0).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    co = (close_df / open_df - 1.0).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    pos_m2 = position_df.shift(2).fillna(0.0)
    pos_m1 = position_df.shift(1).fillna(0.0)
    gross = (pos_m2 * oc + pos_m1 * co).sum(axis=1)
    turnover = (pos_m1 - pos_m2).abs().sum(axis=1)
    transaction_cost = turnover * rate
    return gross - transaction_cost


def _simulate_execution_positions(
    desired_position_df: pd.DataFrame,
    open_df: pd.DataFrame,
    high_df: pd.DataFrame,
    low_df: pd.DataFrame,
    close_df: pd.DataFrame,
    volume_df: pd.DataFrame,
    metadata: ProgramMetadata,
    initial_equity: float,
) -> tuple[pd.DataFrame, pd.Series, pd.Series]:
    """
    OHLCV-based execution approximation:
    - latency: desired target is delayed by N bars before execution
    - partial fills: per-bar capacity constrained by participation of dollar volume
    - dynamic spread: base spread + fraction of bar range
    - impact: quadratic bps vs participation ratio
    Returns (executed_positions, per_bar_execution_cost_frac, per_bar_executed_turnover).
    """
    latency = max(0, int(metadata.execution_latency_bars) + int(metadata.onchain_latency_bars))
    delayed = desired_position_df.shift(latency).fillna(0.0) if latency > 0 else desired_position_df.copy()
    idx = desired_position_df.index
    cols = list(desired_position_df.columns)
    executed = pd.DataFrame(0.0, index=idx, columns=cols, dtype=float)
    costs = pd.Series(0.0, index=idx, dtype=float)
    turnover = pd.Series(0.0, index=idx, dtype=float)
    current = pd.Series(0.0, index=cols, dtype=float)
    equity_anchor = max(float(initial_equity), 1.0)
    max_part = min(max(float(metadata.max_participation_rate), 0.0001), 1.0)
    min_notional = max(float(metadata.min_bar_notional), 0.0)
    spread_base = max(float(metadata.spread_bps_base), 0.0)
    spread_range_factor = max(float(metadata.spread_bps_range_factor), 0.0)
    impact_coeff = max(float(metadata.impact_bps_coeff), 0.0)

    for i in idx:
        desired = delayed.loc[i].astype(float)
        o = open_df.loc[i].astype(float)
        h = high_df.loc[i].astype(float)
        l = low_df.loc[i].astype(float)
        c = close_df.loc[i].astype(float)
        v = volume_df.loc[i].astype(float)
        px = c.where(c > 0.0, o.where(o > 0.0, 1.0))
        dollar_volume = (v.clip(lower=0.0) * px).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
        usable_notional = dollar_volume.where(dollar_volume >= min_notional, 0.0)
        cap_w = (usable_notional * max_part / equity_anchor).clip(lower=0.0).replace([float("inf"), float("-inf")], 0.0)

        delta = desired - current
        fill = delta.clip(lower=-cap_w, upper=cap_w).fillna(0.0)
        nxt = (current + fill).clip(lower=-1.0, upper=1.0)
        executed.loc[i] = nxt
        abs_fill = fill.abs()
        turn = float(abs_fill.sum())
        turnover.loc[i] = turn

        range_ratio = ((h - l).abs() / px.replace(0.0, float("nan"))).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
        spread_bps = (
            spread_base
            + (spread_range_factor * range_ratio * 10_000.0)
            + float(metadata.dex_synthetic_spread_bps)
        )
        participation = (abs_fill / cap_w.replace(0.0, float("nan"))).replace([float("inf"), float("-inf")], 1.0).fillna(0.0).clip(0.0, 5.0)
        impact_bps = impact_coeff * (participation**2)
        per_symbol_cost = abs_fill * ((spread_bps + impact_bps + float(metadata.fee_bps) + float(metadata.slippage_bps)) / 10_000.0)
        costs.loc[i] = float(per_symbol_cost.sum())
        current = nxt

    return executed, costs, turnover


def _simulate_order_lifecycle(
    desired_position_df: pd.DataFrame,
    open_df: pd.DataFrame,
    high_df: pd.DataFrame,
    low_df: pd.DataFrame,
    close_df: pd.DataFrame,
    volume_df: pd.DataFrame,
    metadata: ProgramMetadata,
    initial_equity: float,
) -> tuple[pd.DataFrame, pd.Series, pd.Series, list[dict[str, Any]], dict[str, Any]]:
    """
    Event-driven order lifecycle simulator:
    - creates orders from delayed desired target deltas
    - tracks submitted/partially_filled/filled/canceled states
    - fills incrementally each bar with participation constraints
    """
    latency = max(0, int(metadata.execution_latency_bars) + int(metadata.onchain_latency_bars))
    delayed = desired_position_df.shift(latency).fillna(0.0) if latency > 0 else desired_position_df.copy()
    idx = desired_position_df.index
    cols = list(desired_position_df.columns)
    executed = pd.DataFrame(0.0, index=idx, columns=cols, dtype=float)
    costs = pd.Series(0.0, index=idx, dtype=float)
    turnover = pd.Series(0.0, index=idx, dtype=float)
    current = pd.Series(0.0, index=cols, dtype=float)
    open_orders: dict[str, dict[str, Any]] = {}
    order_rows: list[dict[str, Any]] = []
    next_id = 1

    equity_anchor = max(float(initial_equity), 1.0)
    max_part = min(max(float(metadata.max_participation_rate), 0.0001), 1.0)
    min_notional = max(float(metadata.min_bar_notional), 0.0)
    spread_base = max(float(metadata.spread_bps_base), 0.0)
    spread_range_factor = max(float(metadata.spread_bps_range_factor), 0.0)
    impact_coeff = max(float(metadata.impact_bps_coeff), 0.0)
    imbalance_sensitivity = max(float(metadata.quote_imbalance_sensitivity), 0.0)
    reversion_to_mid = min(max(float(metadata.quote_reversion_to_mid), 0.0), 1.0)

    # Liquidity-regime calibration per symbol from observed dollar volume.
    dv_hist = (volume_df.fillna(0.0) * close_df.where(close_df > 0.0, open_df.where(open_df > 0.0, 1.0))).replace(
        [float("inf"), float("-inf")], 0.0
    )
    symbol_dv = dv_hist.median(axis=0).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    positive_dv = symbol_dv[symbol_dv > 0.0]
    q1 = float(positive_dv.quantile(0.33)) if len(positive_dv) else 0.0
    q2 = float(positive_dv.quantile(0.66)) if len(positive_dv) else 0.0
    liq_profile: dict[str, dict[str, float | str]] = {}
    for sym in cols:
        dv = float(symbol_dv.get(sym, 0.0))
        if dv <= 0.0 or dv <= q1:
            regime = "low"
            spread_mult, impact_mult, part_mult, cap_mult = 1.35, 1.6, 0.7, 1.2
        elif dv <= q2:
            regime = "mid"
            spread_mult, impact_mult, part_mult, cap_mult = 1.0, 1.0, 1.0, 1.0
        else:
            regime = "high"
            spread_mult, impact_mult, part_mult, cap_mult = 0.75, 0.7, 1.4, 0.5
        liq_profile[sym] = {
            "regime": regime,
            "median_dollar_volume": dv,
            "spread_mult": spread_mult,
            "impact_mult": impact_mult,
            "participation_mult": part_mult,
            "capacity_mult": cap_mult,
        }

    for ts in idx:
        desired = delayed.loc[ts].astype(float)
        o = open_df.loc[ts].astype(float)
        h = high_df.loc[ts].astype(float)
        l = low_df.loc[ts].astype(float)
        c = close_df.loc[ts].astype(float)
        v = volume_df.loc[ts].astype(float)
        px = c.where(c > 0.0, o.where(o > 0.0, 1.0))
        dollar_volume = (v.clip(lower=0.0) * px).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
        usable_notional = dollar_volume.where(dollar_volume >= min_notional, 0.0)
        part_series = pd.Series(
            {sym: max_part * float(liq_profile[sym]["participation_mult"]) for sym in cols},
            index=cols,
            dtype=float,
        ).clip(lower=0.0001, upper=1.5)
        cap_notional_mult = pd.Series(
            {sym: float(liq_profile[sym]["capacity_mult"]) for sym in cols},
            index=cols,
            dtype=float,
        ).clip(lower=0.1, upper=3.0)
        cap_w = (
            usable_notional * cap_notional_mult * part_series / equity_anchor
        ).clip(lower=0.0).replace([float("inf"), float("-inf")], 0.0)
        bar_fill = pd.Series(0.0, index=cols, dtype=float)
        bar_cost = 0.0

        # 1) Submit/replace orders from target deltas
        for sym in cols:
            target_delta = float(desired.loc[sym] - current.loc[sym])
            existing = open_orders.get(sym)
            if abs(target_delta) <= 1e-12:
                continue
            if existing is not None and abs(float(existing["remaining_qty"]) - target_delta) <= 1e-12:
                continue
            if existing is not None:
                existing["status"] = "canceled"
                existing["final_time"] = str(ts)
                order_rows.append(existing.copy())
                open_orders.pop(sym, None)
            side = "buy" if target_delta > 0 else "sell"
            open_orders[sym] = {
                "order_id": next_id,
                "symbol": sym,
                "side": side,
                "submit_time": str(ts),
                "final_time": "",
                "requested_qty": float(target_delta),
                "filled_qty": 0.0,
                "remaining_qty": float(target_delta),
                "avg_fill_price": 0.0,
                "fills": 0,
                "status": "submitted",
            }
            next_id += 1

        # 2) Attempt fills for open orders
        for sym in cols:
            order = open_orders.get(sym)
            if order is None:
                continue
            rem = float(order["remaining_qty"])
            if abs(rem) <= 1e-12:
                order["status"] = "filled"
                order["final_time"] = str(ts)
                order_rows.append(order.copy())
                open_orders.pop(sym, None)
                continue
            cap = float(cap_w.loc[sym])
            if cap <= 0.0:
                continue
            sign = 1.0 if rem > 0 else -1.0
            fill_qty = sign * min(abs(rem), cap)
            if abs(fill_qty) <= 0.0:
                continue

            # Quote-aware fill model: synthetic bid/ask around mid + impact.
            base_px = float(o.loc[sym] if o.loc[sym] > 0 else px.loc[sym])
            range_ratio = float(abs(float(h.loc[sym]) - float(l.loc[sym])) / max(base_px, 1e-9))
            spread_bps = (
                (spread_base + (spread_range_factor * range_ratio * 10_000.0)) * float(liq_profile[sym]["spread_mult"])
                + float(metadata.dex_synthetic_spread_bps)
            )
            participation = min(abs(fill_qty) / max(cap, 1e-9), 5.0)
            impact_bps = impact_coeff * float(liq_profile[sym]["impact_mult"]) * (participation**2)
            # Approximate quote imbalance from bar direction and range pressure.
            bar_dir = (float(c.loc[sym]) - float(o.loc[sym])) / max(base_px, 1e-9)
            imbalance = max(min((bar_dir / max(range_ratio, 1e-9)) * imbalance_sensitivity, 0.9), -0.9) if range_ratio > 0 else 0.0
            half_spread = (spread_bps / 2.0) / 10_000.0
            mid = base_px
            bid = mid * (1.0 - half_spread * (1.0 + max(imbalance, 0.0)))
            ask = mid * (1.0 + half_spread * (1.0 + max(-imbalance, 0.0)))
            touch_px = ask if fill_qty > 0 else bid
            impact_px = base_px * ((impact_bps + float(metadata.fee_bps) + float(metadata.slippage_bps)) / 10_000.0)
            impacted_touch = touch_px + impact_px if fill_qty > 0 else touch_px - impact_px
            # Partial mean-reversion towards mid when order completes across the bar.
            fill_px = (1.0 - reversion_to_mid) * impacted_touch + reversion_to_mid * mid

            prev_abs = abs(float(order["filled_qty"]))
            new_abs = prev_abs + abs(fill_qty)
            if new_abs > 0:
                order["avg_fill_price"] = ((float(order["avg_fill_price"]) * prev_abs) + (fill_px * abs(fill_qty))) / new_abs
            order["filled_qty"] = float(order["filled_qty"]) + float(fill_qty)
            order["remaining_qty"] = float(order["remaining_qty"]) - float(fill_qty)
            order["fills"] = int(order["fills"]) + 1
            order["liquidity_regime"] = str(liq_profile[sym]["regime"])
            order["status"] = "partially_filled" if abs(float(order["remaining_qty"])) > 1e-12 else "filled"
            if order["status"] == "filled":
                order["final_time"] = str(ts)
                order_rows.append(order.copy())
                open_orders.pop(sym, None)

            bar_fill.loc[sym] += float(fill_qty)
            effective_bps = abs(fill_px - base_px) / max(base_px, 1e-9) * 10_000.0
            bar_cost += abs(float(fill_qty)) * (effective_bps / 10_000.0)

        nxt = (current + bar_fill).clip(lower=-1.0, upper=1.0)
        executed.loc[ts] = nxt
        turnover.loc[ts] = float(bar_fill.abs().sum())
        costs.loc[ts] = float(bar_cost)
        current = nxt

    # Close any dangling orders as canceled at series end.
    if len(idx):
        end_ts = str(idx[-1])
        for order in open_orders.values():
            order["status"] = "canceled"
            order["final_time"] = end_ts
            order_rows.append(order.copy())

    regime_counts = {"low": 0, "mid": 0, "high": 0}
    for profile in liq_profile.values():
        regime = str(profile["regime"])
        if regime in regime_counts:
            regime_counts[regime] += 1
    calibration = {
        "policy": "symbol_median_dollar_volume_terciles",
        "regime_counts": regime_counts,
        "symbols": liq_profile,
    }
    return executed, costs, turnover, order_rows, calibration


def _master_bar_left_edges(master_index: pd.DatetimeIndex) -> pd.Series:
    mi = master_index
    if len(mi) == 0:
        return pd.Series(dtype="datetime64[ns, UTC]")
    delta = mi.to_series().diff().median()
    if pd.isna(delta) or delta == pd.Timedelta(0):
        delta = pd.Timedelta(days=1)
    left = mi.to_series().shift(1)
    left.iloc[0] = mi[0] - delta
    return pd.Series(left.values, index=mi)


def _micro_events_in_window(
    quotes: pd.DataFrame | None,
    trades: pd.DataFrame | None,
    left: pd.Timestamp,
    right: pd.Timestamp,
    max_events: int,
) -> list[dict[str, Any]]:
    """Merge quote/trade microstructure into ordered micro-events within (left, right]."""
    ev: list[dict[str, Any]] = []
    if quotes is not None and not quotes.empty:
        q = quotes[(quotes.index > left) & (quotes.index <= right)]
        for t, row in q.iterrows():
            bid = float(row.get("bid", 0) or 0)
            ask = float(row.get("ask", 0) or 0)
            if bid <= 0 or ask <= 0:
                continue
            mid = (bid + ask) / 2.0
            bs = float(row.get("bid_size", 0) or 0)
            ask_s = float(row.get("ask_size", 0) or 0)
            # Quote depth: notional at touch + geometric mean of sizes as liquidity proxy
            dv_quote = abs(mid) * (bs + ask_s) if (bs + ask_s) > 0 else abs(mid) * 100.0
            ts = pd.Timestamp(t)
            if ts.tzinfo is None:
                ts = ts.tz_localize("UTC")
            else:
                ts = ts.tz_convert("UTC")
            ev.append(
                {
                    "ts": ts,
                    "kind": "quote",
                    "o": float(mid),
                    "h": float(ask),
                    "l": float(bid),
                    "c": float(mid),
                    "v": float(dv_quote / max(abs(mid), 1e-9)),
                    "dollar_vol": float(dv_quote),
                }
            )
    if trades is not None and not trades.empty:
        tr = trades[(trades.index > left) & (trades.index <= right)]
        for t, row in tr.iterrows():
            px = float(row["price"])
            sz = float(row.get("size", 0) or 0)
            dv = abs(px * sz) if sz > 0 else abs(px) * 10.0
            ts = pd.Timestamp(t)
            if ts.tzinfo is None:
                ts = ts.tz_localize("UTC")
            else:
                ts = ts.tz_convert("UTC")
            ev.append(
                {
                    "ts": ts,
                    "kind": "trade",
                    "o": px,
                    "h": px,
                    "l": px,
                    "c": px,
                    "v": sz,
                    "dollar_vol": float(dv),
                }
            )
    ev.sort(key=lambda x: x["ts"])
    if len(ev) > max_events:
        step = max(1, len(ev) // max_events)
        ev = ev[::step]
    return ev


def _blend_micro_dollar_volume(events: list[dict[str, Any]], usable_bar: float, blend_w: float) -> None:
    """Blend tape-implied DV with equal split of bar OHLCV dollar volume (LPFT_EXEC_MICRO_OHLCV_BLEND)."""
    if not events:
        return
    n = len(events)
    per = float(usable_bar) / max(n, 1)
    w = max(0.0, min(1.0, blend_w))
    for ev in events:
        dv = float(ev.get("dollar_vol", 0.0))
        ev["dollar_vol"] = w * dv + (1.0 - w) * per


def _use_microstructure_execution(
    execution: dict[str, tuple[pd.DataFrame | None, pd.DataFrame | None]],
) -> bool:
    if str(os.getenv("LPFT_ENGINE_USE_MICRO_EXECUTION", "1") or "1").strip().lower() in {"0", "false", "no", "off"}:
        return False
    for q, t in execution.values():
        if q is not None and not q.empty:
            return True
        if t is not None and not t.empty:
            return True
    return False


def _should_run_ohlcv_execution_baseline() -> bool:
    return str(os.getenv("LPFT_ENGINE_BASELINE_OHLCV_EXECUTION", "1") or "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _equity_micro_mtm_enabled() -> bool:
    return str(os.getenv("LPFT_ENGINE_MICRO_EQUITY_MTM", "1") or "1").strip().lower() not in {"0", "false", "no", "off"}


def _simulate_order_lifecycle_microstructure(
    desired_position_df: pd.DataFrame,
    open_df: pd.DataFrame,
    high_df: pd.DataFrame,
    low_df: pd.DataFrame,
    close_df: pd.DataFrame,
    volume_df: pd.DataFrame,
    metadata: ProgramMetadata,
    initial_equity: float,
    execution: dict[str, tuple[pd.DataFrame | None, pd.DataFrame | None]],
) -> tuple[pd.DataFrame, pd.Series, pd.Series, list[dict[str, Any]], dict[str, Any], pd.Series | None]:
    """
    Same contract as _simulate_order_lifecycle, but fills iterate over merged quote/trade timestamps per bar.
    Falls back to one OHLCV step per bar when no micro-events exist for a symbol.
    Optionally builds mark-to-market equity on micro prices (LPFT_ENGINE_MICRO_EQUITY_MTM).
    """
    latency = max(0, int(metadata.execution_latency_bars) + int(metadata.onchain_latency_bars))
    delayed = desired_position_df.shift(latency).fillna(0.0) if latency > 0 else desired_position_df.copy()
    idx = desired_position_df.index
    cols = list(desired_position_df.columns)
    executed = pd.DataFrame(0.0, index=idx, columns=cols, dtype=float)
    costs = pd.Series(0.0, index=idx, dtype=float)
    turnover = pd.Series(0.0, index=idx, dtype=float)
    current = pd.Series(0.0, index=cols, dtype=float)
    open_orders: dict[str, dict[str, Any]] = {}
    order_rows: list[dict[str, Any]] = []
    next_id = 1

    equity_anchor = max(float(initial_equity), 1.0)
    max_part = min(max(float(metadata.max_participation_rate), 0.0001), 1.0)
    min_notional = max(float(metadata.min_bar_notional), 0.0)
    spread_base = max(float(metadata.spread_bps_base), 0.0)
    spread_range_factor = max(float(metadata.spread_bps_range_factor), 0.0)
    impact_coeff = max(float(metadata.impact_bps_coeff), 0.0)
    imbalance_sensitivity = max(float(metadata.quote_imbalance_sensitivity), 0.0)
    reversion_to_mid = min(max(float(metadata.quote_reversion_to_mid), 0.0), 1.0)

    dv_hist = (volume_df.fillna(0.0) * close_df.where(close_df > 0.0, open_df.where(open_df > 0.0, 1.0))).replace(
        [float("inf"), float("-inf")], 0.0
    )
    symbol_dv = dv_hist.median(axis=0).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    positive_dv = symbol_dv[symbol_dv > 0.0]
    q1 = float(positive_dv.quantile(0.33)) if len(positive_dv) else 0.0
    q2 = float(positive_dv.quantile(0.66)) if len(positive_dv) else 0.0
    liq_profile: dict[str, dict[str, float | str]] = {}
    for sym in cols:
        dv = float(symbol_dv.get(sym, 0.0))
        if dv <= 0.0 or dv <= q1:
            regime = "low"
            spread_mult, impact_mult, part_mult, cap_mult = 1.35, 1.6, 0.7, 1.2
        elif dv <= q2:
            regime = "mid"
            spread_mult, impact_mult, part_mult, cap_mult = 1.0, 1.0, 1.0, 1.0
        else:
            regime = "high"
            spread_mult, impact_mult, part_mult, cap_mult = 0.75, 0.7, 1.4, 0.5
        liq_profile[sym] = {
            "regime": regime,
            "median_dollar_volume": dv,
            "spread_mult": spread_mult,
            "impact_mult": impact_mult,
            "participation_mult": part_mult,
            "capacity_mult": cap_mult,
        }

    left_edges = _master_bar_left_edges(idx)
    max_micro = max(50, int(os.getenv("LPFT_EXEC_MICRO_MAX_EVENTS_PER_BAR", "2000") or "2000"))
    dv_blend = float(os.getenv("LPFT_EXEC_MICRO_OHLCV_BLEND", "0.65") or "0.65")
    track_mtm = _equity_micro_mtm_enabled()
    equity_micro_series: pd.Series | None = None
    equity_micro_running = float(initial_equity)
    if track_mtm:
        equity_micro_series = pd.Series(index=idx, dtype=float)

    for ts in idx:
        left = pd.Timestamp(left_edges.loc[ts])
        if left.tzinfo is None:
            left = left.tz_localize("UTC")
        else:
            left = left.tz_convert("UTC")
        desired = delayed.loc[ts].astype(float)
        o = open_df.loc[ts].astype(float)
        h = high_df.loc[ts].astype(float)
        l = low_df.loc[ts].astype(float)
        c = close_df.loc[ts].astype(float)
        v = volume_df.loc[ts].astype(float)
        px = c.where(c > 0.0, o.where(o > 0.0, 1.0))
        dollar_volume = (v.clip(lower=0.0) * px).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
        usable_notional_bar = dollar_volume.where(dollar_volume >= min_notional, 0.0)
        part_series = pd.Series(
            {sym: max_part * float(liq_profile[sym]["participation_mult"]) for sym in cols},
            index=cols,
            dtype=float,
        ).clip(lower=0.0001, upper=1.5)
        cap_notional_mult = pd.Series(
            {sym: float(liq_profile[sym]["capacity_mult"]) for sym in cols},
            index=cols,
            dtype=float,
        ).clip(lower=0.1, upper=3.0)
        cap_w = (
            usable_notional_bar * cap_notional_mult * part_series / equity_anchor
        ).clip(lower=0.0).replace([float("inf"), float("-inf")], 0.0)

        for sym in cols:
            target_delta = float(desired.loc[sym] - current.loc[sym])
            existing = open_orders.get(sym)
            if abs(target_delta) <= 1e-12:
                continue
            if existing is not None and abs(float(existing["remaining_qty"]) - target_delta) <= 1e-12:
                continue
            if existing is not None:
                existing["status"] = "canceled"
                existing["final_time"] = str(ts)
                order_rows.append(existing.copy())
                open_orders.pop(sym, None)
            side = "buy" if target_delta > 0 else "sell"
            open_orders[sym] = {
                "order_id": next_id,
                "symbol": sym,
                "side": side,
                "submit_time": str(ts),
                "final_time": "",
                "requested_qty": float(target_delta),
                "filled_qty": 0.0,
                "remaining_qty": float(target_delta),
                "avg_fill_price": 0.0,
                "fills": 0,
                "status": "submitted",
            }
            next_id += 1

        bar_fill = pd.Series(0.0, index=cols, dtype=float)
        bar_cost = 0.0

        per_sym_events: dict[str, list[dict[str, Any]]] = {}
        for sym in cols:
            q_ex, t_ex = execution.get(sym, (None, None))
            raw_micro = _micro_events_in_window(q_ex, t_ex, left, pd.Timestamp(ts), max_micro)
            if not raw_micro:
                per_sym_events[sym] = [
                    {
                        "ts": pd.Timestamp(ts),
                        "kind": "ohlcv",
                        "o": float(o.loc[sym]),
                        "h": float(h.loc[sym]),
                        "l": float(l.loc[sym]),
                        "c": float(c.loc[sym]),
                        "v": float(v.loc[sym]),
                        "dollar_vol": float(usable_notional_bar.loc[sym]),
                    }
                ]
            else:
                _blend_micro_dollar_volume(raw_micro, float(usable_notional_bar.loc[sym]), dv_blend)
                per_sym_events[sym] = raw_micro

        global_events: list[tuple[str, dict[str, Any]]] = []
        for sym in cols:
            for ev in per_sym_events[sym]:
                global_events.append((sym, ev))
        global_events.sort(key=lambda x: (x[1]["ts"], x[0]))

        w_mtm = current.copy()
        P = o.astype(float).copy()
        for sym, ev in global_events:
            mid_ev = float(ev["c"])
            if track_mtm:
                r_mtm = 0.0
                for i in cols:
                    p_old = float(P.loc[i])
                    p_new = mid_ev if i == sym else p_old
                    r_mtm += float(w_mtm.loc[i]) * (p_new - p_old) / max(p_old, 1e-9)
                P.loc[sym] = mid_ev
                equity_micro_running *= max(1e-9, 1.0 + r_mtm)

            order = open_orders.get(sym)
            if order is None:
                continue
            rem = float(order["remaining_qty"])
            if abs(rem) <= 1e-12:
                order["status"] = "filled"
                order["final_time"] = str(ts)
                order_rows.append(order.copy())
                open_orders.pop(sym, None)
                continue

            _o = float(ev["o"])
            _h = float(ev["h"])
            _l = float(ev["l"])
            _c = float(ev["c"])
            _v = float(ev["v"])
            dv_micro = float(ev.get("dollar_vol", abs(_c * _v)))
            usable_micro = dv_micro if dv_micro >= min_notional else 0.0
            use_ohlcv_cap = str(ev.get("kind", "")) == "ohlcv"
            if use_ohlcv_cap:
                cap = float(cap_w.loc[sym])
            else:
                cap = float(
                    usable_micro * float(cap_notional_mult.loc[sym]) * float(part_series.loc[sym]) / equity_anchor
                )

            if cap <= 0.0:
                continue
            sign = 1.0 if rem > 0 else -1.0
            fill_qty = sign * min(abs(rem), cap)
            if abs(fill_qty) <= 0.0:
                continue

            base_px = float(_o if _o > 0 else _c if _c > 0 else px.loc[sym])
            range_ratio = float(abs(_h - _l) / max(base_px, 1e-9))
            spread_bps = (
                (spread_base + (spread_range_factor * range_ratio * 10_000.0)) * float(liq_profile[sym]["spread_mult"])
                + float(metadata.dex_synthetic_spread_bps)
            )
            participation = min(abs(fill_qty) / max(cap, 1e-9), 5.0)
            impact_bps = impact_coeff * float(liq_profile[sym]["impact_mult"]) * (participation**2)
            bar_dir = (float(_c) - float(_o)) / max(base_px, 1e-9)
            imbalance = (
                max(min((bar_dir / max(range_ratio, 1e-9)) * imbalance_sensitivity, 0.9), -0.9) if range_ratio > 0 else 0.0
            )
            half_spread = (spread_bps / 2.0) / 10_000.0
            mid = base_px
            bid = mid * (1.0 - half_spread * (1.0 + max(imbalance, 0.0)))
            ask = mid * (1.0 + half_spread * (1.0 + max(-imbalance, 0.0)))
            touch_px = ask if fill_qty > 0 else bid
            impact_px = base_px * ((impact_bps + float(metadata.fee_bps) + float(metadata.slippage_bps)) / 10_000.0)
            impacted_touch = touch_px + impact_px if fill_qty > 0 else touch_px - impact_px
            fill_px = (1.0 - reversion_to_mid) * impacted_touch + reversion_to_mid * mid

            prev_abs = abs(float(order["filled_qty"]))
            new_abs = prev_abs + abs(fill_qty)
            if new_abs > 0:
                order["avg_fill_price"] = ((float(order["avg_fill_price"]) * prev_abs) + (fill_px * abs(fill_qty))) / new_abs
            order["filled_qty"] = float(order["filled_qty"]) + float(fill_qty)
            order["remaining_qty"] = float(order["remaining_qty"]) - float(fill_qty)
            order["fills"] = int(order["fills"]) + 1
            order["liquidity_regime"] = str(liq_profile[sym]["regime"])
            order["status"] = "partially_filled" if abs(float(order["remaining_qty"])) > 1e-12 else "filled"
            if order["status"] == "filled":
                order["final_time"] = str(ts)
                order_rows.append(order.copy())
                open_orders.pop(sym, None)

            bar_fill.loc[sym] += float(fill_qty)
            effective_bps = abs(fill_px - base_px) / max(base_px, 1e-9) * 10_000.0
            bar_cost += abs(float(fill_qty)) * (effective_bps / 10_000.0)
            if track_mtm:
                w_mtm.loc[sym] += float(fill_qty)

        if track_mtm and equity_micro_series is not None:
            r_close = 0.0
            for i in cols:
                p_old = float(P.loc[i])
                p_new = float(c.loc[i])
                r_close += float(w_mtm.loc[i]) * (p_new - p_old) / max(p_old, 1e-9)
            equity_micro_running *= max(1e-9, 1.0 + r_close)
            equity_micro_running *= max(1e-9, 1.0 - float(bar_cost))
            equity_micro_series.loc[ts] = equity_micro_running

        nxt = (current + bar_fill).clip(lower=-1.0, upper=1.0)
        executed.loc[ts] = nxt
        turnover.loc[ts] = float(bar_fill.abs().sum())
        costs.loc[ts] = float(bar_cost)
        current = nxt

    if len(idx):
        end_ts = str(idx[-1])
        for order in open_orders.values():
            order["status"] = "canceled"
            order["final_time"] = end_ts
            order_rows.append(order.copy())

    regime_counts = {"low": 0, "mid": 0, "high": 0}
    for profile in liq_profile.values():
        regime = str(profile["regime"])
        if regime in regime_counts:
            regime_counts[regime] += 1
    calibration = {
        "policy": "symbol_median_dollar_volume_terciles",
        "regime_counts": regime_counts,
        "symbols": liq_profile,
        "timeline": "microstructure_quotes_trades_global_time_merge_per_bar",
        "micro_ohlcv_blend": float(os.getenv("LPFT_EXEC_MICRO_OHLCV_BLEND", "0.65") or "0.65"),
        "micro_equity_mtm": bool(track_mtm),
    }
    return executed, costs, turnover, order_rows, calibration, equity_micro_series if track_mtm else None


def _sanitize_ohlcv(ohlcv: pd.DataFrame) -> pd.DataFrame:
    safe_ohlcv = ohlcv.copy()
    if not isinstance(safe_ohlcv.index, pd.DatetimeIndex):
        safe_ohlcv.index = pd.to_datetime(safe_ohlcv.index, errors="coerce")
    safe_ohlcv = safe_ohlcv[~safe_ohlcv.index.isna()]
    safe_ohlcv = safe_ohlcv.sort_index()
    required = ["open", "high", "low", "close", "volume"]
    missing = [col for col in required if col not in safe_ohlcv.columns]
    if missing:
        raise ProgramSecurityError(f"OHLCV missing columns: {', '.join(missing)}")
    safe_ohlcv = safe_ohlcv[required].astype(float).dropna()
    if safe_ohlcv.empty:
        raise ProgramSecurityError("OHLCV empty after sanitization")
    safe_ohlcv.index.name = ohlcv.index.name or "datetime"
    return safe_ohlcv


def _series_from_any(value: Any, index: pd.Index, fill_value: float = 0.0) -> pd.Series:
    if isinstance(value, pd.Series):
        series = value.copy()
    else:
        series = pd.Series(value, index=index)
    return series.reindex(index).fillna(fill_value).astype(float)


def _bool_series_from_any(value: Any, index: pd.Index) -> pd.Series:
    if isinstance(value, pd.Series):
        series = value.copy()
    else:
        series = pd.Series(value, index=index)
    return series.reindex(index).fillna(False).astype(bool)


def _events_to_target(
    index: pd.Index,
    *,
    entries: Any = None,
    exits: Any = None,
    short_entries: Any = None,
    short_exits: Any = None,
) -> pd.Series:
    entry_series = _bool_series_from_any(entries, index) if entries is not None else pd.Series(False, index=index)
    exit_series = _bool_series_from_any(exits, index) if exits is not None else pd.Series(False, index=index)
    short_entry_series = (
        _bool_series_from_any(short_entries, index) if short_entries is not None else pd.Series(False, index=index)
    )
    short_exit_series = (
        _bool_series_from_any(short_exits, index) if short_exits is not None else pd.Series(False, index=index)
    )
    out: list[float] = []
    position = 0.0
    for idx in index:
        if exit_series.loc[idx] and position > 0:
            position = 0.0
        if short_exit_series.loc[idx] and position < 0:
            position = 0.0
        if entry_series.loc[idx]:
            position = 1.0
        if short_entry_series.loc[idx]:
            position = -1.0
        out.append(position)
    return pd.Series(out, index=index, dtype=float)


def _legacy_signal_series_to_target(series: pd.Series, metadata: ProgramMetadata) -> pd.Series:
    position = 0.0
    out: list[float] = []
    for raw in series.fillna(0.0).astype(float):
        if raw > 0:
            position = 1.0
        elif raw < 0:
            position = -1.0 if metadata.position_mode == "long_short" and metadata.signal_semantics == "target_position" else 0.0
        out.append(position)
    return pd.Series(out, index=series.index, dtype=float)


def _normalize_program_output(out: Any, index: pd.Index, metadata: ProgramMetadata) -> pd.Series:
    if isinstance(out, pd.DataFrame):
        if "target_position" in out.columns:
            return _series_from_any(out["target_position"], index)
        if "signals" in out.columns:
            series = _series_from_any(out["signals"], index)
            return _legacy_signal_series_to_target(series, metadata)
        raise ProgramSecurityError("DataFrame output must include target_position or signals")

    if isinstance(out, dict):
        if "target_position" in out:
            return _series_from_any(out["target_position"], index)
        if any(key in out for key in ("entries", "exits", "short_entries", "short_exits")):
            return _events_to_target(
                index,
                entries=out.get("entries"),
                exits=out.get("exits"),
                short_entries=out.get("short_entries"),
                short_exits=out.get("short_exits"),
            )
        if "signals" in out:
            series = _series_from_any(out["signals"], index)
            return _legacy_signal_series_to_target(series, metadata)
        if "position" in out:
            return _series_from_any(out["position"], index)
        raise ProgramSecurityError("Unsupported dict output from program")

    if isinstance(out, pd.Series):
        series = _series_from_any(out, index)
        if metadata.signal_semantics == "target_position":
            return series
        return _legacy_signal_series_to_target(series, metadata)

    if isinstance(out, (tuple, list)):
        if len(out) >= 4:
            return _events_to_target(
                index,
                entries=out[0],
                exits=out[1],
                short_entries=out[2],
                short_exits=out[3],
            )
        if len(out) >= 2:
            return _events_to_target(index, entries=out[0], exits=out[1])

    raise ProgramSecurityError("Program output must be Series, DataFrame, dict, or entry/exit tuple")


def run_generate_positions(code: str, ohlcv: pd.DataFrame) -> pd.Series:
    metadata = extract_program_metadata(code)
    program_body = _coerce_common_series_initializers(_strip_metadata_header(code))
    validate_python(program_body)
    safe_ohlcv = _sanitize_ohlcv(ohlcv)
    locs: dict[str, Any] = {
        "pd": pd,
        "pandas": pd,
        "ohlcv": safe_ohlcv,
        "data": safe_ohlcv.copy(),
        "sma": sma,
        "ema": ema,
        "rsi": rsi,
        "macd": macd,
        "macd_hist": macd_hist,
        "bollinger_bands": bollinger_bands,
        "atr": atr,
        "__builtins__": {
            "__import__": _safe_import,
            "min": min,
            "max": max,
            "abs": abs,
            "len": len,
            "sum": sum,
            "range": range,
            "int": int,
            "float": float,
            "bool": bool,
            "list": list,
            "dict": dict,
            "set": set,
            "sorted": sorted,
            "any": any,
            "all": all,
            "enumerate": enumerate,
            "zip": zip,
            "locals": locals,
            "Exception": Exception,
            "ValueError": ValueError,
        },
    }
    try:
        exec(program_body, locs)
        generator = locs.get("generate_positions") or locs.get("generate_signals")
        if callable(generator):
            out = generator(safe_ohlcv)
        elif "target_position" in locs:
            out = locs["target_position"]
        elif "position" in locs:
            out = locs["position"]
        elif "signals" in locs:
            out = locs["signals"]
        else:
            raise ProgramSecurityError("generate_positions or generate_signals not found")
    except (TypeError, ValueError) as exc:
        if "for dtype 'int64'" in str(exc):
            raise ProgramSecurityError(
                "Program attempted to assign float values into an integer Series. "
                "Initialize signal or position series with 0.0 instead of 0, for example "
                "pd.Series(0.0, index=data.index)."
            ) from exc
        raise
    target = _normalize_program_output(out, safe_ohlcv.index, metadata)
    if metadata.position_mode != "long_short":
        target = target.clip(lower=0.0, upper=1.0)
    else:
        target = target.clip(lower=-1.0, upper=1.0)
    return target.fillna(0.0).astype(float)


def _apply_risk_overlays(close: pd.Series, target: pd.Series, metadata: ProgramMetadata) -> pd.Series:
    adjusted = target.copy().astype(float)
    position = 0.0
    entry_price: float | None = None
    peak_price: float | None = None
    trough_price: float | None = None

    for idx in adjusted.index:
        desired = float(adjusted.loc[idx])
        price = float(close.loc[idx])

        if position != 0.0 and entry_price is not None:
            if position > 0:
                peak_price = price if peak_price is None else max(peak_price, price)
                stop_hit = metadata.stop_loss_pct is not None and price <= entry_price * (1.0 - metadata.stop_loss_pct)
                take_hit = metadata.take_profit_pct is not None and price >= entry_price * (1.0 + metadata.take_profit_pct)
                trailing_hit = (
                    metadata.trailing_stop_pct is not None
                    and peak_price is not None
                    and price <= peak_price * (1.0 - metadata.trailing_stop_pct)
                )
            else:
                trough_price = price if trough_price is None else min(trough_price, price)
                stop_hit = metadata.stop_loss_pct is not None and price >= entry_price * (1.0 + metadata.stop_loss_pct)
                take_hit = metadata.take_profit_pct is not None and price <= entry_price * (1.0 - metadata.take_profit_pct)
                trailing_hit = (
                    metadata.trailing_stop_pct is not None
                    and trough_price is not None
                    and price >= trough_price * (1.0 + metadata.trailing_stop_pct)
                )
            if stop_hit or take_hit or trailing_hit:
                desired = 0.0

        if position == 0.0 and desired != 0.0:
            entry_price = price
            peak_price = price
            trough_price = price
        elif position != 0.0 and desired == 0.0:
            entry_price = None
            peak_price = None
            trough_price = None
        elif position != 0.0 and desired != 0.0 and math.copysign(1.0, position) != math.copysign(1.0, desired):
            entry_price = price
            peak_price = price
            trough_price = price

        position = desired
        adjusted.loc[idx] = desired

    return adjusted


def _extract_trade_rows_bar_close(
    symbol: str,
    close: pd.Series,
    position: pd.Series,
    initial_equity: float,
) -> list[dict[str, Any]]:
    """Fill at signal bar close (same bar as target update)."""
    trades: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    for idx in position.index:
        current_pos = float(position.loc[idx])
        price = float(close.loc[idx])
        if current is None and current_pos != 0.0:
            current = {
                "entry_time": idx,
                "entry_price": price,
                "entry_weight": abs(current_pos),
                "side": "long" if current_pos > 0 else "short",
            }
            continue

        if current is None:
            continue

        side_sign = 1.0 if current["side"] == "long" else -1.0
        side_changed = current_pos == 0.0 or math.copysign(1.0, current_pos) != side_sign
        if side_changed:
            entry_price = float(current["entry_price"])
            if current["side"] == "long":
                pnl_pct = (price / entry_price) - 1.0 if entry_price else 0.0
            else:
                pnl_pct = (entry_price / price) - 1.0 if price else 0.0
            trades.append(
                {
                    "symbol": symbol,
                    "side": current["side"],
                    "entry_time": str(current["entry_time"]),
                    "exit_time": str(idx),
                    "entry_price": entry_price,
                    "exit_price": price,
                    "pnl_pct": float(pnl_pct),
                    "pnl": float(pnl_pct * initial_equity * float(current["entry_weight"])),
                    "execution": "bar_close",
                }
            )
            current = None
            if current_pos != 0.0:
                current = {
                    "entry_time": idx,
                    "entry_price": price,
                    "entry_weight": abs(current_pos),
                    "side": "long" if current_pos > 0 else "short",
                }

    if current is not None:
        final_idx = position.index[-1]
        final_price = float(close.loc[final_idx])
        entry_price = float(current["entry_price"])
        if current["side"] == "long":
            pnl_pct = (final_price / entry_price) - 1.0 if entry_price else 0.0
        else:
            pnl_pct = (entry_price / final_price) - 1.0 if final_price else 0.0
        trades.append(
            {
                "symbol": symbol,
                "side": current["side"],
                "entry_time": str(current["entry_time"]),
                "exit_time": str(final_idx),
                "entry_price": entry_price,
                "exit_price": final_price,
                "pnl_pct": float(pnl_pct),
                "pnl": float(pnl_pct * initial_equity * float(current["entry_weight"])),
                "execution": "bar_close",
            }
        )
    return trades


def _extract_trade_rows_next_bar_open(
    symbol: str,
    close: pd.Series,
    open_: pd.Series,
    position: pd.Series,
    initial_equity: float,
) -> list[dict[str, Any]]:
    """Signal at close j-1 executes at open j; prices at open for entries/exits."""
    trades: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    open_ = open_.reindex(close.index).astype(float)
    open_ = open_.where(open_.notna() & (open_ > 0), close)

    idx_list = list(position.index)
    if len(idx_list) < 2:
        return _extract_trade_rows_bar_close(symbol, close, position, initial_equity)

    def _append_trade(
        side: str,
        entry_time: Any,
        entry_price: float,
        exit_time: Any,
        exit_price: float,
        entry_weight: float,
    ) -> None:
        if side == "long":
            pnl_pct = (exit_price / entry_price) - 1.0 if entry_price else 0.0
        else:
            pnl_pct = (entry_price / exit_price) - 1.0 if exit_price else 0.0
        trades.append(
            {
                "symbol": symbol,
                "side": side,
                "entry_time": str(entry_time),
                "exit_time": str(exit_time),
                "entry_price": float(entry_price),
                "exit_price": float(exit_price),
                "pnl_pct": float(pnl_pct),
                "pnl": float(pnl_pct * initial_equity * float(entry_weight)),
                "execution": "next_bar_open",
            }
        )

    # At open of bar j, transition from raw[j-2] to raw[j-1] (targets after close j-2 vs j-1).
    for j in range(1, len(idx_list)):
        idx_j = idx_list[j]
        old = float(position.iloc[j - 2]) if j >= 2 else 0.0
        new = float(position.iloc[j - 1])
        exec_price = float(open_.loc[idx_j])
        exec_time = idx_j

        if old > 0 and new <= 0:
            if current is not None and current["side"] == "long":
                _append_trade("long", current["entry_time"], current["entry_price"], exec_time, exec_price, current["entry_weight"])
                current = None
        if old < 0 and new >= 0:
            if current is not None and current["side"] == "short":
                _append_trade("short", current["entry_time"], current["entry_price"], exec_time, exec_price, current["entry_weight"])
                current = None

        if new != 0.0:
            if old > 0 and new > 0:
                if current is None:
                    current = {
                        "entry_time": exec_time,
                        "entry_price": exec_price,
                        "entry_weight": abs(new),
                        "side": "long",
                    }
                else:
                    current["entry_weight"] = abs(new)
            elif old < 0 and new < 0:
                if current is None:
                    current = {
                        "entry_time": exec_time,
                        "entry_price": exec_price,
                        "entry_weight": abs(new),
                        "side": "short",
                    }
                else:
                    current["entry_weight"] = abs(new)
            else:
                current = {
                    "entry_time": exec_time,
                    "entry_price": exec_price,
                    "entry_weight": abs(new),
                    "side": "long" if new > 0 else "short",
                }
        elif old == 0.0 and new == 0.0:
            pass
        else:
            current = None

    if current is not None:
        final_idx = idx_list[-1]
        final_price = float(close.loc[final_idx])
        entry_price = float(current["entry_price"])
        if current["side"] == "long":
            pnl_pct = (final_price / entry_price) - 1.0 if entry_price else 0.0
        else:
            pnl_pct = (entry_price / final_price) - 1.0 if final_price else 0.0
        trades.append(
            {
                "symbol": symbol,
                "side": current["side"],
                "entry_time": str(current["entry_time"]),
                "exit_time": str(final_idx),
                "entry_price": entry_price,
                "exit_price": final_price,
                "pnl_pct": float(pnl_pct),
                "pnl": float(pnl_pct * initial_equity * float(current["entry_weight"])),
                "execution": "next_bar_open",
            }
        )
    return trades


def _extract_trade_rows(
    symbol: str,
    close: pd.Series,
    position: pd.Series,
    initial_equity: float,
    *,
    open_: pd.Series | None = None,
    entry_timing: str = "bar_close",
) -> list[dict[str, Any]]:
    timing = str(entry_timing).lower().replace("-", "_")
    if timing == "next_bar_open" and open_ is not None:
        return _extract_trade_rows_next_bar_open(symbol, close, open_, position, initial_equity)
    return _extract_trade_rows_bar_close(symbol, close, position, initial_equity)


def _write_artifacts(
    output_dir: Path,
    program_code: str,
    equity_series: pd.Series,
    trade_rows: list[dict[str, Any]],
    order_rows: list[dict[str, Any]],
    metrics: dict[str, float],
    validation: dict[str, Any],
    *,
    equity_micro_series: pd.Series | None = None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    equity_series.to_csv(output_dir / "equity.csv", header=True)
    if equity_micro_series is not None and len(equity_micro_series):
        equity_micro_series.to_csv(output_dir / "equity_micro.csv", header=True)
    # Keep a stable CSV schema even with zero trades.
    pd.DataFrame(trade_rows, columns=_TRADE_COLUMNS).to_csv(output_dir / "trades.csv", index=False)
    pd.DataFrame(order_rows).to_csv(output_dir / "orders.csv", index=False)
    (output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    (output_dir / "validation.json").write_text(json.dumps(validation, indent=2))
    (output_dir / "code.py").write_text(program_code)


def write_validation_artifact(output_dir: Path, validation: dict[str, Any], program_code: str = "") -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "validation.json").write_text(json.dumps(validation, indent=2))
    if program_code:
        (output_dir / "code.py").write_text(program_code)


def run_backtest_from_market_data(
    market_data: dict[str, pd.DataFrame | MarketDataSnapshot],
    program_code: str,
    output_dir: Path,
    *,
    initial_equity: float = 10_000.0,
) -> dict[str, float]:
    metadata = extract_program_metadata(program_code)
    snapshot_map: dict[str, MarketDataSnapshot] = {}
    dataframe_map: dict[str, pd.DataFrame] = {}
    for symbol, payload in market_data.items():
        if isinstance(payload, MarketDataSnapshot):
            snapshot_map[symbol] = payload
            dataframe_map[symbol] = payload.ohlcv
        else:
            dataframe_map[symbol] = payload
    available_symbols = [
        symbol
        for symbol in metadata.symbols
        if symbol in dataframe_map and dataframe_map[symbol] is not None and not getattr(dataframe_map[symbol], "empty", True)
    ]
    if not available_symbols:
        available_symbols = [symbol for symbol, df in dataframe_map.items() if df is not None and not getattr(df, "empty", True)]
    if not available_symbols:
        raise RuntimeError("No OHLCV data")

    sanitized: dict[str, pd.DataFrame] = {symbol: _sanitize_ohlcv(dataframe_map[symbol]) for symbol in available_symbols}
    master_index = sanitized[available_symbols[0]].index
    for symbol in available_symbols[1:]:
        master_index = master_index.union(sanitized[symbol].index)
    master_index = master_index.sort_values()

    per_symbol_cap = min(metadata.max_position_pct, metadata.max_gross_exposure / max(1, len(available_symbols)))
    close_map: dict[str, pd.Series] = {}
    open_map: dict[str, pd.Series] = {}
    high_map: dict[str, pd.Series] = {}
    low_map: dict[str, pd.Series] = {}
    volume_map: dict[str, pd.Series] = {}
    position_map: dict[str, pd.Series] = {}

    for symbol in available_symbols:
        ohlcv = sanitized[symbol]
        target = run_generate_positions(program_code, ohlcv)
        target = _apply_risk_overlays(ohlcv["close"], target, metadata)
        scaled = target * per_symbol_cap
        close_map[symbol] = ohlcv["close"].reindex(master_index).ffill().astype(float)
        open_map[symbol] = ohlcv["open"].reindex(master_index).ffill().astype(float)
        high_map[symbol] = ohlcv["high"].reindex(master_index).ffill().astype(float)
        low_map[symbol] = ohlcv["low"].reindex(master_index).ffill().astype(float)
        volume_map[symbol] = ohlcv["volume"].reindex(master_index).fillna(0.0).astype(float)
        position_map[symbol] = scaled.reindex(master_index).ffill().fillna(0.0).astype(float)

    desired_position_df = pd.DataFrame(position_map, index=master_index).fillna(0.0)
    gross = desired_position_df.abs().sum(axis=1)
    scale = pd.Series(1.0, index=desired_position_df.index, dtype=float)
    oversized = gross > metadata.max_gross_exposure
    scale.loc[oversized] = metadata.max_gross_exposure / gross.loc[oversized]
    desired_position_df = desired_position_df.mul(scale, axis=0)

    close_df = pd.DataFrame(close_map, index=master_index).astype(float)
    open_df = pd.DataFrame(open_map, index=master_index).astype(float)
    high_df = pd.DataFrame(high_map, index=master_index).astype(float)
    low_df = pd.DataFrame(low_map, index=master_index).astype(float)
    volume_df = pd.DataFrame(volume_map, index=master_index).fillna(0.0).astype(float)
    execution_map: dict[str, tuple[pd.DataFrame | None, pd.DataFrame | None]] = {}
    for symbol in available_symbols:
        snap = snapshot_map.get(symbol)
        if snap is not None:
            execution_map[symbol] = (snap.execution_quotes, snap.execution_trades)
        else:
            execution_map[symbol] = (None, None)

    ohlcv_baseline_comparison: dict[str, Any] | None = None
    equity_micro_series: pd.Series | None = None
    if _use_microstructure_execution(execution_map):
        (
            position_df,
            execution_cost,
            executed_turnover,
            order_rows,
            execution_calibration,
            equity_micro_series,
        ) = _simulate_order_lifecycle_microstructure(
            desired_position_df,
            open_df,
            high_df,
            low_df,
            close_df,
            volume_df,
            metadata,
            initial_equity,
            execution_map,
        )
        timeline_source = "microstructure_quotes_trades"
        if _should_run_ohlcv_execution_baseline():
            _, baseline_cost, _, _, baseline_cal = _simulate_order_lifecycle(
                desired_position_df,
                open_df,
                high_df,
                low_df,
                close_df,
                volume_df,
                metadata,
                initial_equity,
            )
            micro_sum = float(execution_cost.sum())
            base_sum = float(baseline_cost.sum())
            ohlcv_baseline_comparison = {
                "micro_total_execution_cost_frac": micro_sum,
                "ohlcv_baseline_total_execution_cost_frac": base_sum,
                "delta_micro_minus_baseline_frac": micro_sum - base_sum,
                "baseline_calibration": baseline_cal,
            }
    else:
        position_df, execution_cost, executed_turnover, order_rows, execution_calibration = _simulate_order_lifecycle(
            desired_position_df,
            open_df,
            high_df,
            low_df,
            close_df,
            volume_df,
            metadata,
            initial_equity,
        )
        timeline_source = "ohlcv_bars"
    periods_per_year = _periods_per_year_from_index(master_index)
    borrow_drag = _borrow_drag_fraction_per_bar(
        position_df,
        float(metadata.borrow_bps),
        periods_per_year,
        position_mode=str(metadata.position_mode),
    )
    rate = _sanitize_rate(0.0, 0.0)
    timing = str(metadata.entry_timing).lower().replace("-", "_")
    if timing == "next_bar_open":
        portfolio_returns = _portfolio_returns_next_bar_open(position_df, close_df, open_df, rate) - execution_cost
    else:
        portfolio_returns = _portfolio_returns_bar_close(position_df, close_df, rate) - execution_cost
    portfolio_returns = portfolio_returns - borrow_drag
    portfolio_returns = _clip_portfolio_returns(portfolio_returns)

    equity_values: list[float] = []
    equity = float(initial_equity)
    for idx in master_index:
        if not equity_values:
            equity_values.append(equity)
            continue
        equity *= max(0.0, 1.0 + float(portfolio_returns.loc[idx]))
        equity_values.append(float(equity))
    equity_series = pd.Series(equity_values, index=master_index, name="equity")
    returns = equity_series.pct_change().fillna(0.0)
    peak = equity_series.cummax()
    drawdown = (equity_series / peak - 1.0).fillna(0.0)

    trade_rows: list[dict[str, Any]] = []
    for symbol in available_symbols:
        trade_rows.extend(
            _extract_trade_rows(
                symbol,
                close_df[symbol],
                position_df[symbol],
                initial_equity,
                open_=open_df[symbol],
                entry_timing=metadata.entry_timing,
            )
        )

    wins = sum(1 for row in trade_rows if float(row["pnl_pct"]) > 0)
    std = float(returns.std(ddof=0)) if len(returns) else 0.0
    mean = float(returns.mean()) if len(returns) else 0.0
    sharpe = (mean / std) * math.sqrt(periods_per_year) if std > 0 else 0.0
    trade_pnl_simple_sum = sum(float(row["pnl"]) for row in trade_rows) if trade_rows else 0.0
    net_pnl_val = float(equity_series.iloc[-1] - equity_series.iloc[0]) if len(equity_series) else 0.0
    metrics = {
        "total_return": float(equity_series.iloc[-1] / equity_series.iloc[0] - 1.0) if len(equity_series) > 1 else 0.0,
        "net_pnl": net_pnl_val,
        "max_drawdown": float(drawdown.min()) if len(drawdown) else 0.0,
        "sharpe_ratio": float(sharpe),
        "num_trades": float(len(trade_rows)),
        "win_rate": float(wins / len(trade_rows)) if trade_rows else 0.0,
        "final_equity": float(equity_series.iloc[-1]) if len(equity_series) else float(initial_equity),
        "initial_equity": float(initial_equity),
        "symbols_traded": float(len(available_symbols)),
        "gross_exposure_cap": float(metadata.max_gross_exposure),
        "sharpe_annualization_bars_per_year": float(periods_per_year),
        "avg_executed_turnover": float(executed_turnover.mean()) if len(executed_turnover) else 0.0,
        "num_orders": float(len(order_rows)),
    }
    if ohlcv_baseline_comparison is not None:
        metrics["execution_micro_total_cost_frac"] = float(ohlcv_baseline_comparison["micro_total_execution_cost_frac"])
        metrics["execution_ohlcv_baseline_total_cost_frac"] = float(
            ohlcv_baseline_comparison["ohlcv_baseline_total_execution_cost_frac"]
        )
        metrics["execution_micro_minus_ohlcv_cost_frac"] = float(ohlcv_baseline_comparison["delta_micro_minus_baseline_frac"])
    metrics.update(_compute_advanced_metrics(returns, equity_series, periods_per_year, trade_rows))
    quality_checks = _run_engine_quality_checks(equity_series, portfolio_returns, execution_cost)
    validation = {
        "status": "valid",
        "engine_version": metadata.engine_version,
        "artifact_type": metadata.artifact_type,
        "strategy_kind": metadata.strategy_kind,
        "position_mode": metadata.position_mode,
        "symbols_requested": metadata.symbols,
        "symbols_used": available_symbols,
        "capability_status": metadata.capability_status,
        "capability_summary": metadata.capability_summary,
        "warnings": metadata.warnings,
        "engine_quality": quality_checks,
        "data_policy": {
            "asset_class": metadata.asset_class,
            "provider_preference": metadata.provider_preference,
            "quality_policy": metadata.quality_policy,
            "freshness_requirement": metadata.freshness_requirement,
            "coverage_requirement": metadata.coverage_requirement,
            "corporate_actions_required": metadata.corporate_actions_required,
            "market": metadata.market,
        },
        "data_sources": [
            snapshot_map[symbol].quality.to_dict()
            for symbol in available_symbols
            if symbol in snapshot_map
        ],
        "execution_model": {
            "entry_timing": metadata.entry_timing,
            "position_return_convention": (
                "next_bar_open: per bar j, gross return = raw[j-2]*(open[j]/close[j-1]-1) + raw[j-1]*(close[j]/open[j]-1); "
                "turnover at open j = |raw[j-1]-raw[j-2]|. Signal at close j-1 fills at open j. "
                "bar_close: gross return = raw[j-1]*(close[j]/close[j-1]-1); turnover = |raw[j]-raw[j-1]|."
            ),
            "transaction_costs": "Turnover (per mode above) * (fee_bps + slippage_bps) / 10000 each bar.",
            "pnl_and_equity_convention": (
                "Signals and gross portfolio returns use the OHLCV bar grid (close/open). "
                "When quote/trade microstructure is present, order fills follow a merged per-bar timeline (all symbols sorted by event time); "
                "execution costs are applied per bar. Primary equity (equity.csv) is bar-based and compounds portfolio_returns "
                "(including borrow_bps drag on short legs when long_short). "
                "Optional equity_micro.csv (when micro data + LPFT_ENGINE_MICRO_EQUITY_MTM) marks PnL on micro mids plus close-to-bar; "
                "excludes borrow drag unless extended later."
            ),
            "live_demo_gap": (
                "Residual gaps vs live: extended-hours, borrow spikes, halts, and crypto 24h vs RTH session models may differ."
            ),
            "execution_simulator": {
                "latency_bars": int(metadata.execution_latency_bars),
                "onchain_latency_bars": int(metadata.onchain_latency_bars),
                "dex_synthetic_spread_bps": float(metadata.dex_synthetic_spread_bps),
                "max_participation_rate": float(metadata.max_participation_rate),
                "min_bar_notional": float(metadata.min_bar_notional),
                "spread_bps_base": float(metadata.spread_bps_base),
                "spread_bps_range_factor": float(metadata.spread_bps_range_factor),
                "impact_bps_coeff": float(metadata.impact_bps_coeff),
                "quote_imbalance_sensitivity": float(metadata.quote_imbalance_sensitivity),
                "quote_reversion_to_mid": float(metadata.quote_reversion_to_mid),
                "borrow_bps_annual": float(metadata.borrow_bps),
                "order_states": ["submitted", "partially_filled", "filled", "canceled"],
                "calibration": execution_calibration,
                "timeline_source": timeline_source,
                "ohlcv_baseline_comparison": ohlcv_baseline_comparison,
                "equity_micro_mtm_available": equity_micro_series is not None,
            },
        },
        "metrics_notes": {
            "sharpe_ratio": (
                "Annualized as (mean/std)*sqrt(bars_per_year) on equity pct-change series; "
                "bars_per_year inferred from median bar spacing."
            ),
            "trade_list_pnl": (
                "trades.csv pnl is pnl_pct * initial_equity * entry_weight (non-compounded, per-trade label). "
                "It does not generally sum to net_pnl with multi-symbol portfolios, fees, or compounding."
            ),
            "trade_pnl_simple_sum": float(trade_pnl_simple_sum),
            "net_pnl": float(net_pnl_val),
        },
    }
    _write_artifacts(
        Path(output_dir),
        program_code,
        equity_series,
        trade_rows,
        order_rows,
        metrics,
        validation,
        equity_micro_series=equity_micro_series,
    )
    return metrics


def build_validation_ohlcv(timeframe: str) -> pd.DataFrame:
    freq_map = {
        "1m": "min",
        "5m": "5min",
        "15m": "15min",
        "30m": "30min",
        "1h": "h",
        "1d": "D",
    }
    freq = freq_map.get(timeframe or "1d", "D")
    periods = 260 if freq == "D" else 400
    index = pd.date_range(end=pd.Timestamp.now(tz="UTC").floor("min"), periods=periods, freq=freq, tz="UTC")
    base = pd.Series(range(periods), index=index, dtype=float)
    wave = pd.Series([math.sin(step / 7.0) for step in range(periods)], index=index, dtype=float)
    regime = pd.Series([math.sin(step / 19.0) for step in range(periods)], index=index, dtype=float)
    close = 100.0 + base * 0.08 + wave * 2.5 + regime * 1.8
    open_ = close.shift(1).fillna(close.iloc[0] - 0.4)
    high = pd.concat([open_, close], axis=1).max(axis=1) + 0.6 + regime.abs() * 0.3
    low = pd.concat([open_, close], axis=1).min(axis=1) - 0.6 - regime.abs() * 0.3
    volume = pd.Series([1_000_000 + (step % 17) * 15_000 for step in range(periods)], index=index, dtype=float)
    return pd.DataFrame(
        {
            "open": open_.astype(float),
            "high": high.astype(float),
            "low": low.astype(float),
            "close": close.astype(float),
            "volume": volume.astype(float),
        },
        index=index,
    )
