from __future__ import annotations

from typing import Any

import pandas as pd

ProgramSecurityError = type("ProgramSecurityError", (Exception,), {})


class ProgramSignals:
    def __init__(self, series: pd.Series):
        self.series = series


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


def macd_default_3(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    macd_line, signal_line = macd(series, fast, slow, signal)
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


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
        "macd_default_3": macd_default_3,
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
