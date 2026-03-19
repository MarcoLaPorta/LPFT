from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from lpft_shared.market_data import MarketDataSnapshot

ENGINE_VERSION = "lpft-engine-v2"
_META_PREFIX = "# LPFT-META: "
_INT_SERIES_INIT_RE = re.compile(r"(\b(?:pd|pandas)\.Series\(\s*)(-?1|0|1)(\s*,)")


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


def _extract_trade_rows(
    symbol: str,
    close: pd.Series,
    position: pd.Series,
    initial_equity: float,
) -> list[dict[str, Any]]:
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
            }
        )
    return trades


def _write_artifacts(
    output_dir: Path,
    program_code: str,
    equity_series: pd.Series,
    trade_rows: list[dict[str, Any]],
    metrics: dict[str, float],
    validation: dict[str, Any],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    equity_series.to_csv(output_dir / "equity.csv", header=True)
    pd.DataFrame(trade_rows).to_csv(output_dir / "trades.csv", index=False)
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
    position_map: dict[str, pd.Series] = {}

    for symbol in available_symbols:
        ohlcv = sanitized[symbol]
        target = run_generate_positions(program_code, ohlcv)
        target = _apply_risk_overlays(ohlcv["close"], target, metadata)
        scaled = target * per_symbol_cap
        close_map[symbol] = ohlcv["close"].reindex(master_index).ffill().astype(float)
        position_map[symbol] = scaled.reindex(master_index).ffill().fillna(0.0).astype(float)

    position_df = pd.DataFrame(position_map, index=master_index).fillna(0.0)
    gross = position_df.abs().sum(axis=1)
    scale = pd.Series(1.0, index=position_df.index, dtype=float)
    oversized = gross > metadata.max_gross_exposure
    scale.loc[oversized] = metadata.max_gross_exposure / gross.loc[oversized]
    position_df = position_df.mul(scale, axis=0)

    close_df = pd.DataFrame(close_map, index=master_index).astype(float)
    returns_df = (close_df / close_df.shift(1) - 1.0).replace([float("inf"), float("-inf")], 0.0).fillna(0.0)
    prev_position_df = position_df.shift(1).fillna(0.0)
    turnover = (position_df - prev_position_df).abs().sum(axis=1)
    transaction_cost = turnover * ((metadata.fee_bps + metadata.slippage_bps) / 10_000.0)
    portfolio_returns = (prev_position_df * returns_df).sum(axis=1) - transaction_cost

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
            )
        )

    wins = sum(1 for row in trade_rows if float(row["pnl_pct"]) > 0)
    std = float(returns.std(ddof=0)) if len(returns) else 0.0
    mean = float(returns.mean()) if len(returns) else 0.0
    sharpe = (mean / std) * math.sqrt(252.0) if std > 0 else 0.0
    metrics = {
        "total_return": float(equity_series.iloc[-1] / equity_series.iloc[0] - 1.0) if len(equity_series) > 1 else 0.0,
        "net_pnl": float(equity_series.iloc[-1] - equity_series.iloc[0]) if len(equity_series) else 0.0,
        "max_drawdown": float(drawdown.min()) if len(drawdown) else 0.0,
        "sharpe_ratio": float(sharpe),
        "num_trades": float(len(trade_rows)),
        "win_rate": float(wins / len(trade_rows)) if trade_rows else 0.0,
        "final_equity": float(equity_series.iloc[-1]) if len(equity_series) else float(initial_equity),
        "symbols_traded": float(len(available_symbols)),
        "gross_exposure_cap": float(metadata.max_gross_exposure),
    }
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
    }
    _write_artifacts(Path(output_dir), program_code, equity_series, trade_rows, metrics, validation)
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
