from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field

from lpft_api.dsl import StrategyKind, StrategySpec


class CapabilityStatus(str, Enum):
    supported = "supported"
    supported_with_warnings = "supported_with_warnings"
    unsupported_with_conversion_path = "unsupported_with_conversion_path"
    unsupported_missing_data = "unsupported_missing_data"


class CapabilityReport(BaseModel):
    status: CapabilityStatus
    summary: str
    warnings: list[str] = Field(default_factory=list)
    missing_requirements: list[str] = Field(default_factory=list)
    conversion_suggestions: list[str] = Field(default_factory=list)
    engine_path: str = "deterministic_compiler"
    asset_class: str = "equity"
    provider_plan: str = "auto"
    quality_policy: str = "best_effort"


def assess_strategy_spec(spec: StrategySpec) -> CapabilityReport:
    warnings: list[str] = []
    missing: list[str] = []
    suggestions: list[str] = []
    status = CapabilityStatus.supported
    engine_path = "deterministic_compiler"
    asset_class = spec.data.asset_class if spec.data.asset_class != "auto" else "crypto" if any(str(symbol).upper().endswith("-USD") for symbol in spec.universe.symbols) else "equity"
    provider_plan = spec.data.provider_preference
    quality_policy = spec.data.quality_policy

    if spec.data.market_model != "ohlcv":
        missing.append(f"Current engine only supports OHLCV data, not {spec.data.market_model}.")
        suggestions.append("Convert the idea to an OHLCV-based approximation.")
        status = CapabilityStatus.unsupported_missing_data

    if spec.data.requires_intrabar:
        missing.append("Intrabar fill assumptions are not available in the current engine.")
        suggestions.append("Use bar-close or next-bar-open logic instead of intrabar execution rules.")
        status = CapabilityStatus.unsupported_missing_data

    if provider_plan == "stooq" and asset_class == "crypto":
        missing.append("Stooq is not available for crypto data in this project.")
        suggestions.append("Use provider_preference=auto or yahoo for crypto.")
        status = CapabilityStatus.unsupported_with_conversion_path

    if provider_plan == "stooq" and spec.universe.timeframe.value != "1d":
        warnings.append(
            "Stooq provides daily OHLCV only in this project. For intraday backtests, use provider_preference=auto/yahoo."
        )
        suggestions.append("For intraday bars keep timeframe as requested and switch provider_preference to auto or yahoo.")
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if spec.data.history_period is None:
        warnings.append(
            "data.history_period is unset; the backtest will use the client request default. Prefer setting history_period explicitly for reproducibility and user-visible control."
        )
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if quality_policy == "best_effort":
        warnings.append("Free-market-data mode is running in best-effort mode: warnings are surfaced, but non-critical quality issues do not automatically block the run.")
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if asset_class == "crypto":
        warnings.append("Crypto data is treated as 24/7 market data and may differ across free providers.")
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if asset_class in {"equity", "etf"} and spec.data.corporate_actions_required:
        warnings.append("Free equity and ETF feeds can still diverge around corporate action handling.")
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if len(spec.universe.symbols) > 1:
        warnings.append(
            "Multi-symbol requests are backtested as an equal-weight portfolio using the same strategy logic on each symbol."
        )
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if spec.execution.position_mode == "long_short":
        warnings.append("Short exposure is supported on bar data, but fill quality remains OHLCV-based.")
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if spec.kind == StrategyKind.python:
        engine_path = "python_runtime"
        warnings.append("Custom Python is supported, but deterministic built-in strategies are more reliable.")
        if len(spec.universe.symbols) > 1:
            warnings.append("Custom Python is executed independently per symbol and then aggregated at the portfolio level.")
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if spec.kind in {StrategyKind.breakout, StrategyKind.mean_reversion} and spec.execution.position_mode == "long_short":
        warnings.append("This combination is supported, but the assistant may still prefer long-only defaults unless the prompt clearly asks for shorts.")
        if status == CapabilityStatus.supported:
            status = CapabilityStatus.supported_with_warnings

    if status == CapabilityStatus.unsupported_missing_data:
        summary = "This request needs market data or execution assumptions that the current OHLCV engine cannot model faithfully."
        return CapabilityReport(
            status=status,
            summary=summary,
            warnings=warnings,
            missing_requirements=missing,
            conversion_suggestions=suggestions,
            engine_path=engine_path,
            asset_class=asset_class,
            provider_plan=provider_plan,
            quality_policy=quality_policy,
        )

    if status == CapabilityStatus.supported_with_warnings:
        summary = "This strategy is executable, but the assistant should make the remaining modeling assumptions and data caveats explicit before backtesting."
    else:
        summary = "This strategy is compatible with the current shared OHLCV engine."

    return CapabilityReport(
        status=status,
        summary=summary,
        warnings=warnings,
        missing_requirements=missing,
        conversion_suggestions=suggestions,
        engine_path=engine_path,
        asset_class=asset_class,
        provider_plan=provider_plan,
        quality_policy=quality_policy,
    )
