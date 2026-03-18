from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal, Union

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
    rsi = "rsi"
    macd = "macd"
    bollinger = "bollinger"
    python = "python"


class SmaCrossoverParams(BaseModel):
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


class PythonParams(BaseModel):
    code: str


StrategyParams = Union[
    SmaCrossoverParams,
    RsiParams,
    MacdParams,
    BollingerParams,
    PythonParams,
]


class RiskParams(BaseModel):
    max_position_pct: float = Field(default=1.0, ge=0.01, le=1.0)


class Universe(BaseModel):
    symbols: list[str] = Field(min_length=1)
    timeframe: Timeframe = Timeframe.d1


class StrategySpec(BaseModel):
    kind: StrategyKind
    params: StrategyParams
    risk: RiskParams = Field(default_factory=RiskParams)
    universe: Universe

    @model_validator(mode="before")
    @classmethod
    def parse_params_from_kind(cls, data: dict):
        if not isinstance(data, dict):
            return data
        kind = data.get("kind")
        params = data.get("params")
        if isinstance(params, dict) and kind is not None:
            kind_to_type = {
                "sma_crossover": SmaCrossoverParams,
                "rsi": RsiParams,
                "macd": MacdParams,
                "bollinger": BollingerParams,
                "python": PythonParams,
            }
            t = kind_to_type.get(kind)
            if t:
                data = {**data, "params": t.model_validate(params)}
        return data
