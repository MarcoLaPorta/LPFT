from __future__ import annotations

from enum import Enum
from typing import Literal, Union

from pydantic import BaseModel, Field, model_validator


class Timeframe(str, Enum):
    m1 = "1m"
    m5 = "5m"
    m15 = "15m"
    m30 = "30m"
    h1 = "1h"
    d1 = "1d"


PriceField = Literal["open", "high", "low", "close"]


class StrategyKind(str, Enum):
    sma_crossover = "sma_crossover"
    ema_crossover = "ema_crossover"
    rsi = "rsi"
    macd = "macd"
    bollinger = "bollinger"
    breakout = "breakout"
    mean_reversion = "mean_reversion"
    python = "python"


class SmaCrossoverParams(BaseModel):
    fast: int = Field(ge=1, le=200)
    slow: int = Field(ge=1, le=200)
    price: PriceField = "close"


class EmaCrossoverParams(BaseModel):
    fast: int = Field(ge=1, le=200)
    slow: int = Field(ge=1, le=200)
    price: PriceField = "close"


class RsiParams(BaseModel):
    period: int = Field(ge=2, le=100)
    overbought: float = Field(ge=50, le=100)
    oversold: float = Field(ge=0, le=50)
    price: PriceField = "close"


class MacdParams(BaseModel):
    fast: int = Field(ge=1, le=50)
    slow: int = Field(ge=1, le=200)
    signal: int = Field(ge=1, le=50)
    price: PriceField = "close"


class BollingerParams(BaseModel):
    period: int = Field(ge=2, le=200)
    std: float = Field(ge=0.5, le=5.0)
    price: PriceField = "close"


class BreakoutParams(BaseModel):
    lookback: int = Field(ge=2, le=250)
    exit_lookback: int | None = Field(default=None, ge=2, le=250)
    price: PriceField = "close"


class MeanReversionParams(BaseModel):
    period: int = Field(ge=5, le=250)
    entry_z: float = Field(ge=0.5, le=5.0)
    exit_z: float = Field(ge=0.0, le=4.0, default=0.5)
    price: PriceField = "close"


class PythonParams(BaseModel):
    code: str


StrategyParams = Union[
    SmaCrossoverParams,
    EmaCrossoverParams,
    RsiParams,
    MacdParams,
    BollingerParams,
    BreakoutParams,
    MeanReversionParams,
    PythonParams,
]


class RiskParams(BaseModel):
    max_position_pct: float = Field(default=1.0, ge=0.01, le=1.0)
    max_gross_exposure: float = Field(default=1.0, ge=0.01, le=2.0)
    stop_loss_pct: float | None = Field(default=None, ge=0.001, le=0.5)
    take_profit_pct: float | None = Field(default=None, ge=0.001, le=2.0)
    trailing_stop_pct: float | None = Field(default=None, ge=0.001, le=0.5)
    fee_bps: float = Field(default=0.0, ge=0.0, le=100.0)
    slippage_bps: float = Field(default=0.0, ge=0.0, le=100.0)


class ExecutionParams(BaseModel):
    position_mode: Literal["long_only", "long_short"] = "long_only"
    rebalance: Literal["equal_weight", "dynamic"] = "equal_weight"
    entry_timing: Literal["next_bar_open", "bar_close"] = "next_bar_open"


HistoryPeriod = Literal["1m", "3m", "6m", "1y", "2y", "5y"]


class DataRequirements(BaseModel):
    market_model: Literal["ohlcv", "bid_ask", "order_book", "options"] = "ohlcv"
    requires_intrabar: bool = False
    asset_class: Literal["auto", "equity", "etf", "crypto"] = "auto"
    provider_preference: Literal["auto", "yahoo", "stooq", "alpaca"] = "auto"
    quality_policy: Literal["strict_gate", "quality_labels", "best_effort"] = "best_effort"
    freshness_requirement: Literal["relaxed", "standard", "strict"] = "standard"
    coverage_requirement: Literal["relaxed", "standard", "strict"] = "standard"
    corporate_actions_required: bool = False
    market: str | None = None
    notes: str | None = None
    # Storico OHLCV per il backtest (1m|3m|6m|1y|2y|5y). L’LLM dovrebbe valorizzarlo; se null → fallback client + warning in capability.
    history_period: HistoryPeriod | None = None


class Universe(BaseModel):
    symbols: list[str] = Field(min_length=1)
    timeframe: Timeframe = Timeframe.d1


def _default_universe() -> Universe:
    return Universe(symbols=["AAPL"], timeframe=Timeframe.d1)


class StrategySpec(BaseModel):
    kind: StrategyKind
    params: StrategyParams
    risk: RiskParams = Field(default_factory=RiskParams)
    universe: Universe = Field(default_factory=_default_universe)
    execution: ExecutionParams = Field(default_factory=ExecutionParams)
    data: DataRequirements = Field(default_factory=DataRequirements)

    @model_validator(mode="before")
    @classmethod
    def parse_params_from_kind(cls, data: dict):
        if not isinstance(data, dict):
            return data
        if not data.get("universe"):
            data = {**data, "universe": {"symbols": ["AAPL"], "timeframe": "1d"}}
        if not data.get("execution"):
            data = {**data, "execution": {"position_mode": "long_only", "rebalance": "equal_weight", "entry_timing": "next_bar_open"}}
        if not data.get("data"):
            data = {
                **data,
                "data": {
                    "market_model": "ohlcv",
                    "requires_intrabar": False,
                    "asset_class": "auto",
                    "provider_preference": "auto",
                    "quality_policy": "best_effort",
                    "freshness_requirement": "standard",
                    "coverage_requirement": "standard",
                    "corporate_actions_required": False,
                },
            }
        kind = data.get("kind")
        params = data.get("params")
        if kind == "python" and isinstance(params, str):
            data = {**data, "params": {"code": params}}
            params = data["params"]
        if kind == "bollinger" and isinstance(params, dict):
            normalized_params = dict(params)
            if "std" not in normalized_params:
                if "std_dev" in normalized_params:
                    normalized_params["std"] = normalized_params.pop("std_dev")
                elif "stddev" in normalized_params:
                    normalized_params["std"] = normalized_params.pop("stddev")
                elif "stdev" in normalized_params:
                    normalized_params["std"] = normalized_params.pop("stdev")
            data = {**data, "params": normalized_params}
            params = data["params"]
        if kind == "breakout" and isinstance(params, dict):
            normalized_params = dict(params)
            if "lookback" not in normalized_params:
                for alias in ("period", "window", "channel"):
                    if alias in normalized_params:
                        normalized_params["lookback"] = normalized_params.pop(alias)
                        break
            if "exit_lookback" not in normalized_params:
                for alias in ("exit_period", "exit_window"):
                    if alias in normalized_params:
                        normalized_params["exit_lookback"] = normalized_params.pop(alias)
                        break
            data = {**data, "params": normalized_params}
            params = data["params"]
        if kind == "mean_reversion" and isinstance(params, dict):
            normalized_params = dict(params)
            if "period" not in normalized_params:
                for alias in (
                    "lookback_period",
                    "lookback",
                    "window",
                    "length",
                    "z_period",
                    "zscore_period",
                    "rolling_period",
                ):
                    if alias in normalized_params:
                        normalized_params["period"] = normalized_params.pop(alias)
                        break
            if "entry_z" not in normalized_params:
                for alias in ("z_entry", "zscore_entry", "entry_threshold"):
                    if alias in normalized_params:
                        normalized_params["entry_z"] = normalized_params.pop(alias)
                        break
            if "exit_z" not in normalized_params:
                for alias in ("z_exit", "zscore_exit", "exit_threshold"):
                    if alias in normalized_params:
                        normalized_params["exit_z"] = normalized_params.pop(alias)
                        break
            # entry_z / exit_z sono magnitudini positive (il compilatore usa z <= -entry_z per il long).
            if "entry_z" in normalized_params:
                try:
                    ez = float(normalized_params["entry_z"])
                    if ez < 0:
                        ez = abs(ez)
                    normalized_params["entry_z"] = max(0.5, min(5.0, ez))
                except (TypeError, ValueError):
                    pass
            if "exit_z" in normalized_params:
                try:
                    xz = float(normalized_params["exit_z"])
                    if xz < 0:
                        xz = abs(xz)
                    normalized_params["exit_z"] = max(0.0, min(4.0, xz))
                except (TypeError, ValueError):
                    pass
            data = {**data, "params": normalized_params}
            params = data["params"]
        if isinstance(params, dict) and kind is not None:
            kind_to_type = {
                "sma_crossover": SmaCrossoverParams,
                "ema_crossover": EmaCrossoverParams,
                "rsi": RsiParams,
                "macd": MacdParams,
                "bollinger": BollingerParams,
                "breakout": BreakoutParams,
                "mean_reversion": MeanReversionParams,
                "python": PythonParams,
            }
            t = kind_to_type.get(kind)
            if t:
                data = {**data, "params": t.model_validate(params)}
        return data
