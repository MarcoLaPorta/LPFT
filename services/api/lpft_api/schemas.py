from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from lpft_api.db import RunStatus, RunType
from lpft_api.dsl import StrategySpec


class StrategyCreate(BaseModel):
    name: str
    spec: StrategySpec


class StrategyOut(BaseModel):
    id: int
    name: str
    spec: dict

    class Config:
        from_attributes = True


class RunCreate(BaseModel):
    strategy_id: int
    run_type: RunType = RunType.backtest
    period: str = "1y"
    timeframe: str = "1d"
    symbol: str = "AAPL"


class RunOut(BaseModel):
    id: int
    strategy_id: int | None
    status: RunStatus
    run_type: RunType
    program_code: str | None
    period: str | None
    timeframe: str | None
    symbol: str | None
    created_at: str
    error: str | None

    class Config:
        from_attributes = True


class DatasetUploadResponse(BaseModel):
    filename: str
    path: str


class DatasetFetchResponse(BaseModel):
    symbol: str
    period: str
    interval: str
    rows: int
    path: str | None


class GenerateStrategyRequest(BaseModel):
    description: str


class GenerateStrategyResponse(BaseModel):
    spec: StrategySpec


class GenerateProgramRequest(BaseModel):
    strategy_spec: StrategySpec


class GeneratedProgram(BaseModel):
    code: str
    language: Literal["python"] = "python"


class GenerateProgramResponse(BaseModel):
    program: GeneratedProgram


class GenerateAndBacktestRequest(BaseModel):
    strategy_spec: StrategySpec
    period: str = "1y"
    timeframe: str = "1d"
    symbol: str = "AAPL"


class GenerateAndBacktestResponse(BaseModel):
    run_id: int
    program_code: str


class RunProgramRequest(BaseModel):
    run_id: int


class RunProgramResponse(BaseModel):
    run_id: int
    status: RunStatus
