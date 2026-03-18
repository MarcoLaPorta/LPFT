from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import pandas as pd

from lpft_api.market_data import fetch_ohlcv_yahoo


class ProgramSecurityError(Exception):
    pass


def _safe_import(name: str, globals=None, locals=None, fromlist=(), level=0):
    allow = {"pandas", "pd", "numpy", "np"}
    if name not in allow and not (fromlist and all(f in allow for f in fromlist)):
        raise ProgramSecurityError(f"Import not allowed: {name}")
    return __import__(name, globals, locals, fromlist, level)


def _validate_python(code: str) -> None:
    lowered = code.lower()
    if "subprocess" in lowered or "socket" in lowered or "requests" in lowered:
        raise ProgramSecurityError("Disallowed operations")
    if "import os" in lowered or "import sys" in lowered:
        raise ProgramSecurityError("Disallowed operations")


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
    m, s = macd(series, fast, slow, signal)
    return m - s


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


def run_generate_signals(code: str, ohlcv: pd.DataFrame) -> pd.Series:
    _validate_python(code)
    locs: dict[str, Any] = {
        "pd": pd,
        "pandas": pd,
        "ohlcv": ohlcv,
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
        },
    }
    exec(code, locs)
    gen = locs.get("generate_signals")
    if not callable(gen):
        raise ProgramSecurityError("generate_signals not found")
    out = gen(ohlcv)
    if isinstance(out, pd.Series):
        return out
    if isinstance(out, (tuple, list)) and len(out) >= 2:
        entries, exits = out[0], out[1]
        sig = pd.Series(0, index=ohlcv.index).astype(float)
        if hasattr(entries, "values"):
            sig.loc[pd.Series(entries).reindex(ohlcv.index).fillna(False)] = 1.0
        if hasattr(exits, "values"):
            sig.loc[pd.Series(exits).reindex(ohlcv.index).fillna(False)] = -1.0
        return sig
    raise ProgramSecurityError("generate_signals must return Series or (entries, exits)")


_PERIOD_MAP = {"1m": "1mo", "3m": "3mo", "6m": "6mo", "1y": "1y", "2y": "2y", "5y": "5y"}


def run_inline_backtest(
    *,
    symbol: str,
    period: str,
    timeframe: str,
    program_code: str,
    output_dir: Path,
    initial_equity: float = 10_000.0,
) -> dict[str, float]:
    period_norm = _PERIOD_MAP.get(period, period)
    ohlcv = fetch_ohlcv_yahoo(symbol, period=period_norm, interval=timeframe)
    if ohlcv is None or getattr(ohlcv, "empty", True):
        raise RuntimeError("No OHLCV data")
    ohlcv = ohlcv.copy()
    ohlcv = ohlcv.dropna()
    if ohlcv.empty:
        raise RuntimeError("OHLCV empty")

    signals = run_generate_signals(program_code, ohlcv)
    if not isinstance(signals, pd.Series):
        signals = pd.Series(signals, index=ohlcv.index)
    signals = signals.reindex(ohlcv.index).fillna(0.0).astype(float)

    close = ohlcv["close"].astype(float)
    position = 0.0
    equity = float(initial_equity)
    eq = [equity]
    pos_hist = [0.0]
    for i in range(1, len(ohlcv)):
        sig = signals.iloc[i - 1]
        if sig > 0:
            position = 1.0
        elif sig < 0:
            position = 0.0
        ret = close.iloc[i] / close.iloc[i - 1] - 1.0
        equity *= 1.0 + position * ret
        eq.append(float(equity))
        pos_hist.append(float(position))

    equity_series = pd.Series(eq, index=ohlcv.index, name="equity")
    returns = equity_series.pct_change().fillna(0.0)
    peak = equity_series.cummax()
    dd = (equity_series / peak - 1.0).fillna(0.0)
    max_drawdown = float(dd.min()) if len(dd) else 0.0

    # Trade stats (approssimazione long-only)
    pos = pd.Series(pos_hist, index=ohlcv.index)
    entries = (pos.diff().fillna(0) > 0).astype(int)
    exits = (pos.diff().fillna(0) < 0).astype(int)
    entry_idx = list(entries[entries == 1].index)
    exit_idx = list(exits[exits == 1].index)
    # allinea numero trade
    n = min(len(entry_idx), len(exit_idx))
    wins = 0
    trade_rows: list[dict[str, Any]] = []
    for k in range(n):
        e_i = entry_idx[k]
        x_i = exit_idx[k]
        if x_i <= e_i:
            continue
        entry_price = float(close.loc[e_i])
        exit_price = float(close.loc[x_i])
        pnl_pct = (exit_price / entry_price) - 1.0 if entry_price != 0 else 0.0
        pnl = pnl_pct * float(initial_equity)
        if pnl_pct > 0:
            wins += 1
        trade_rows.append(
            {
                "entry_time": str(e_i),
                "exit_time": str(x_i),
                "entry_price": entry_price,
                "exit_price": exit_price,
                "pnl_pct": float(pnl_pct),
                "pnl": float(pnl),
            }
        )
    num_trades = float(len(trade_rows))
    win_rate = float(wins / len(trade_rows)) if trade_rows else 0.0

    total_return = float(equity_series.iloc[-1] / equity_series.iloc[0] - 1.0) if len(equity_series) > 1 else 0.0
    net_pnl = float(equity_series.iloc[-1] - equity_series.iloc[0]) if len(equity_series) else 0.0

    # Sharpe (assumiamo daily)
    std = float(returns.std(ddof=0)) if len(returns) else 0.0
    mean = float(returns.mean()) if len(returns) else 0.0
    sharpe = 0.0
    if std > 0:
        sharpe = (mean / std) * math.sqrt(252.0)

    metrics: dict[str, float] = {
        "total_return": total_return,
        "net_pnl": net_pnl,
        "max_drawdown": max_drawdown,
        "sharpe_ratio": float(sharpe),
        "num_trades": float(num_trades),
        "win_rate": float(win_rate),
        "final_equity": float(equity_series.iloc[-1]) if len(equity_series) else float(initial_equity),
    }

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    equity_series.to_csv(output_dir / "equity.csv", header=True)
    (output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2))
    pd.DataFrame(trade_rows).to_csv(output_dir / "trades.csv", index=False)
    (output_dir / "code.py").write_text(program_code)
    return metrics

