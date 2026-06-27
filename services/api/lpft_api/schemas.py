from __future__ import annotations

from typing import Any, Literal

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
    provider_used: str | None = None
    asset_class: str | None = None
    quality_status: str | None = None
    freshness_status: str | None = None
    coverage_status: str | None = None
    warnings: list[str] = Field(default_factory=list)


class Tier1ValidateRequest(BaseModel):
    equity: list[float] | None = None
    returns: list[float] | None = None
    n_trials: int = Field(default=1, ge=1, le=10_000)
    mc_paths: int = Field(default=10_000, ge=100, le=20_000)
    mc_horizon_days: int = Field(default=30, ge=5, le=365)
    ffd_d: float = Field(default=0.4, ge=0.0, le=1.0)
    cpcv_n_groups: int = Field(default=6, ge=2, le=24)
    cpcv_n_test_groups: int = Field(default=2, ge=1, le=12)
    periods_per_year: float = Field(default=252.0, ge=52, le=365)


class Tier1ValidateResponse(BaseModel):
    version: str
    n_observations: int
    sharpe: float
    dsr: dict
    cvar: dict
    cpcv: dict
    fractional_diff: dict
    monte_carlo: dict


class Tier1MonteCarloRequest(BaseModel):
    returns: list[float]
    horizon_days: int = Field(default=30, ge=5, le=365)
    n_paths: int = Field(default=10_000, ge=100, le=20_000)
    seed: int | None = 42


class Tier1MonteCarloResponse(BaseModel):
    n_paths: int
    horizon_days: int
    terminal_return_p5: float
    terminal_return_p50: float
    terminal_return_p95: float
    terminal_return_mean: float
    var_95: float
    cvar_95: float
    drift_daily: float
    vol_daily: float


class GenerateStrategyRequest(BaseModel):
    description: str


class StrategySpecNormalizationMeta(BaseModel):
    """Campi compilati dal server quando l'LLM omette history_period o data.notes (badge UI)."""

    applied: bool = False
    fields_filled: list[str] = Field(default_factory=list)
    notes_provenance: Literal["llm", "server_auto", "llm_enriched"] = "llm"
    structured_output_mode: Literal["tool_use", "text_json"] = "text_json"
    notes_enrichment_applied: bool = False


class StrategyNotesQuality(BaseModel):
    length: int
    provenance: Literal["llm", "server_auto", "llm_enriched"]
    auto_prefix: bool
    enrichment_applied: bool


class StrategyQualityPanel(BaseModel):
    """Pannello qualità per UI: capability + provenance note + normalizzazione."""

    capability: dict
    spec_normalization: StrategySpecNormalizationMeta
    notes: StrategyNotesQuality


class GenerateStrategyResponse(BaseModel):
    spec: StrategySpec
    spec_normalization: StrategySpecNormalizationMeta = Field(default_factory=StrategySpecNormalizationMeta)
    strategy_quality: StrategyQualityPanel | None = None


class AssistantMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantStreamRequest(BaseModel):
    messages: list[AssistantMessage] = Field(default_factory=list)
    current_run_id: int | None = None
    current_code: str | None = None
    current_spec: StrategySpec | None = None
    symbol: str = "AAPL"
    # When False, the server must not treat `symbol` as a user choice (avoids silent AAPL default).
    symbol_explicit: bool = False
    # True quando la richiesta viene dal form «parametri strategia»: forza generazione codice via LLM (no compilatore built-in).
    llm_python_only: bool = False
    period: str = "5y"
    # Hint for planning / prompts; after generation, backtest uses StrategySpec.universe.timeframe.
    timeframe: str = "1d"


class GenerateProgramRequest(BaseModel):
    strategy_spec: StrategySpec


class GeneratedProgram(BaseModel):
    code: str
    language: Literal["python"] = "python"


class PythonProgramValidation(BaseModel):
    """Validazioni statiche sul codice restituito (successo = tutti True)."""

    ast_ok: bool = True
    security_ok: bool = True


class GenerateProgramResponse(BaseModel):
    program: GeneratedProgram
    validation: PythonProgramValidation = Field(default_factory=PythonProgramValidation)


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
