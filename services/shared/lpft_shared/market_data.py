from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

DATA_VALIDATION_VERSION = "market-data-v1"
EXECUTION_DATA_VERSION = "execution-v2"
VALID_TIMEFRAMES = ("1m", "5m", "15m", "30m", "1h", "1d")
VALID_PERIODS = ("1m", "3m", "6m", "1y", "2y", "5y")
PERIOD_ALIAS = {"1m": "1mo", "3m": "3mo", "6m": "6mo", "1y": "1y", "2y": "2y", "5y": "5y"}
QUALITY_ALLOWED = {"validated_high_confidence", "validated_with_warnings"}


@dataclass
class DataRequest:
    symbol: str
    period: str = "1y"
    timeframe: str = "1d"
    asset_class: str = "equity"
    provider_preference: str = "auto"
    quality_policy: str = "best_effort"
    freshness_requirement: str = "standard"
    coverage_requirement: str = "standard"
    corporate_actions_required: bool = False
    market: str | None = None


@dataclass
class DataQualityReport:
    status: str
    summary: str
    provider_requested: str
    provider_used: str
    asset_class: str
    canonical_symbol: str
    requested_symbol: str
    period: str
    timeframe: str
    fetched_at: str
    freshness_status: str
    coverage_status: str
    rows: int
    coverage_start: str | None
    coverage_end: str | None
    warnings: list[str] = field(default_factory=list)
    validation_version: str = DATA_VALIDATION_VERSION
    cache_key: str | None = None
    cache_path: str | None = None
    manifest_path: str | None = None
    fallback_used: bool = False
    blocked: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MarketDataSnapshot:
    symbol: str
    canonical_symbol: str
    asset_class: str
    provider_used: str
    period: str
    timeframe: str
    ohlcv: pd.DataFrame
    quality: DataQualityReport
    # Optional quote/trade microstructure (aligned to ohlcv time range); engine uses when present.
    execution_quotes: pd.DataFrame | None = None
    execution_trades: pd.DataFrame | None = None


class DataQualityError(Exception):
    def __init__(self, report: DataQualityReport | dict[str, Any]):
        self.report = report.to_dict() if isinstance(report, DataQualityReport) else report
        super().__init__(self.report.get("summary", "Market data quality rejected"))


def dataset_path(storage_dir: Path, filename: str) -> Path:
    return Path(storage_dir) / "datasets" / filename


def normalize_period(period: str) -> str:
    cleaned = str(period or "1y").strip()
    if cleaned not in VALID_PERIODS:
        raise ValueError(f"Unsupported period: {cleaned}")
    return cleaned


def normalize_timeframe(timeframe: str) -> str:
    cleaned = str(timeframe or "1d").strip()
    if cleaned not in VALID_TIMEFRAMES:
        raise ValueError(f"Unsupported timeframe: {cleaned}")
    return cleaned


def infer_asset_class(symbol: str, requested: str | None = None) -> str:
    if requested and requested not in {"auto", ""}:
        return str(requested).strip().lower()
    candidate = str(symbol or "").strip().upper()
    if candidate.endswith("-USD") or candidate.endswith("USDT") or "/" in candidate:
        return "crypto"
    return "equity"


def canonicalize_symbol(symbol: str, asset_class: str) -> str:
    candidate = str(symbol or "").strip().upper()
    if not candidate:
        raise ValueError("Symbol is required")
    if asset_class == "crypto":
        candidate = candidate.replace("/", "-")
        if candidate.endswith("USDT") and "-" not in candidate:
            candidate = f"{candidate[:-4]}-USD"
        elif candidate.endswith("USD") and "-" not in candidate:
            candidate = f"{candidate[:-3]}-USD"
        return candidate
    return candidate.replace("/", "-")


def _safe_component(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in value.strip())
    return cleaned or "unknown"


def build_cache_key(request: DataRequest, provider: str) -> str:
    canonical_symbol = canonicalize_symbol(request.symbol, request.asset_class)
    parts = [
        _safe_component(request.asset_class),
        _safe_component(provider),
        _safe_component(canonical_symbol),
        _safe_component(normalize_period(request.period)),
        _safe_component(normalize_timeframe(request.timeframe)),
    ]
    parts.append(DATA_VALIDATION_VERSION)
    return "__".join(parts)


def _cache_paths(storage_dir: Path, cache_key: str) -> tuple[Path, Path]:
    base = dataset_path(storage_dir, cache_key)
    return base.with_suffix(".csv"), base.with_suffix(".json")


def _expected_rows(request: DataRequest) -> int:
    period = normalize_period(request.period)
    timeframe = normalize_timeframe(request.timeframe)
    period_months = {"1m": 1, "3m": 3, "6m": 6, "1y": 12, "2y": 24, "5y": 60}[period]
    if request.asset_class == "crypto":
        daily_units = 30 * period_months
        bars_per_day = {"1m": 1440, "5m": 288, "15m": 96, "30m": 48, "1h": 24, "1d": 1}[timeframe]
    else:
        daily_units = max(1, round(21 * period_months))
        bars_per_day = {"1m": 390, "5m": 78, "15m": 26, "30m": 13, "1h": 7, "1d": 1}[timeframe]
    return max(1, daily_units * bars_per_day)


def _coverage_threshold(level: str) -> float:
    return {"relaxed": 0.55, "standard": 0.72, "strict": 0.85}.get(level, 0.72)


def _freshness_limit(request: DataRequest) -> timedelta:
    timeframe = normalize_timeframe(request.timeframe)
    requirement = request.freshness_requirement
    if timeframe == "1d":
        base = timedelta(days=5 if request.asset_class == "crypto" else 7)
        if requirement == "strict":
            return timedelta(days=2)
        if requirement == "relaxed":
            return base + timedelta(days=3)
        return base
    units = {"1m": 5, "5m": 20, "15m": 45, "30m": 90, "1h": 240}[timeframe]
    if requirement == "strict":
        return timedelta(minutes=max(5, units * 2))
    if requirement == "relaxed":
        return timedelta(minutes=units * 12)
    return timedelta(minutes=units * 6)


def _normalize_ohlcv_frame(df: pd.DataFrame) -> pd.DataFrame:
    normalized = df.copy()
    normalized.columns = [str(col).strip().lower() for col in normalized.columns]
    if "date" in normalized.columns and "datetime" not in normalized.columns:
        normalized = normalized.rename(columns={"date": "datetime"})
    if "datetime" in normalized.columns:
        normalized["datetime"] = pd.to_datetime(normalized["datetime"], errors="coerce", utc=True)
        normalized = normalized.set_index("datetime")
    elif not isinstance(normalized.index, pd.DatetimeIndex):
        normalized.index = pd.to_datetime(normalized.index, errors="coerce", utc=True)
    else:
        if normalized.index.tz is None:
            normalized.index = normalized.index.tz_localize("UTC")
        else:
            normalized.index = normalized.index.tz_convert("UTC")
    rename_map = {
        "open": "open",
        "high": "high",
        "low": "low",
        "close": "close",
        "volume": "volume",
    }
    normalized = normalized.rename(columns=rename_map)
    required = ["open", "high", "low", "close", "volume"]
    missing = [col for col in required if col not in normalized.columns]
    if missing:
        raise ValueError(f"Missing OHLCV columns: {', '.join(missing)}")
    normalized = normalized[required]
    normalized = normalized[~normalized.index.isna()]
    normalized = normalized.sort_index()
    normalized.index.name = "datetime"
    return normalized


def _fetch_yahoo(request: DataRequest) -> pd.DataFrame:
    ticker = yf.Ticker(canonicalize_symbol(request.symbol, request.asset_class))
    period = normalize_period(request.period)
    timeframe = normalize_timeframe(request.timeframe)
    yahoo_period = PERIOD_ALIAS[period]
    # Yahoo has stricter intraday windows than our generic history periods.
    # Adapt provider period to avoid hard failures like:
    # "Only 8 days worth of 1m granularity data are allowed" / "within last 60 days".
    if timeframe == "1m":
        yahoo_period = "8d"
    elif timeframe in {"5m", "15m", "30m"}:
        # 60d is the practical upper bound for these granularities.
        yahoo_period = "60d"
    elif timeframe == "1h":
        # Intraday hourly endpoint commonly allows up to ~730d.
        yahoo_period = "730d" if period in {"5y"} else yahoo_period
    df = ticker.history(period=yahoo_period, interval=timeframe)
    if df.empty:
        return df
    df = df.rename(
        columns={
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    return _normalize_ohlcv_frame(df)


def _fetch_stooq(request: DataRequest) -> pd.DataFrame:
    if request.asset_class not in {"equity", "etf"}:
        raise ValueError("Stooq only supports equity and ETF routing in this project")
    if normalize_timeframe(request.timeframe) != "1d":
        raise ValueError("Stooq fallback is only available for daily data")
    symbol = canonicalize_symbol(request.symbol, request.asset_class).lower()
    url = f"https://stooq.com/q/d/l/?s={symbol}&i=d"
    df = pd.read_csv(url)
    if df.empty:
        return df
    df = df.rename(
        columns={
            "Date": "datetime",
            "Open": "open",
            "High": "high",
            "Low": "low",
            "Close": "close",
            "Volume": "volume",
        }
    )
    return _normalize_ohlcv_frame(df)


def _us_equity_rth_mask(index: pd.DatetimeIndex) -> pd.Series:
    """
    Regular US equity session (Mon–Fri), 09:30–16:00 America/New_York.
    Disable with LPFT_EQUITY_RTH_FILTER=0.
    """
    if index.empty:
        return pd.Series(dtype=bool)
    flag = str(os.getenv("LPFT_EQUITY_RTH_FILTER", "1") or "1").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return pd.Series(True, index=index)
    ny = ZoneInfo("America/New_York")
    if index.tz is None:
        idx = index.tz_localize("UTC")
    else:
        idx = index.tz_convert("UTC")
    local = idx.tz_convert(ny)
    minute = local.hour * 60 + local.minute
    open_m, close_m = 9 * 60 + 30, 16 * 60
    ok = (local.dayofweek < 5) & (minute >= open_m) & (minute < close_m)
    return pd.Series(ok, index=index)


def fetch_ohlcv_from_provider(provider: str, request: DataRequest) -> pd.DataFrame:
    provider_norm = provider.strip().lower()
    if provider_norm == "yahoo":
        return _fetch_yahoo(request)
    if provider_norm == "stooq":
        return _fetch_stooq(request)
    raise ValueError(f"Unsupported provider: {provider_norm}")


def resolve_provider_candidates(request: DataRequest) -> list[str]:
    timeframe = normalize_timeframe(request.timeframe)
    preferred = str(request.provider_preference or "auto").strip().lower()
    if preferred == "alpaca":
        preferred = "auto"
    if preferred and preferred != "auto":
        return [preferred]
    if request.asset_class == "crypto":
        return ["yahoo"]
    if timeframe == "1d":
        return ["yahoo", "stooq"]
    return ["yahoo"]


def _load_cached_snapshot(storage_dir: Path, cache_key: str) -> tuple[pd.DataFrame | None, dict[str, Any] | None]:
    csv_path, manifest_path = _cache_paths(storage_dir, cache_key)
    if not csv_path.is_file() or not manifest_path.is_file():
        return None, None
    try:
        df = pd.read_csv(csv_path, index_col=0, parse_dates=True)
        manifest = json.loads(manifest_path.read_text())
        if not isinstance(df.index, pd.DatetimeIndex):
            df.index = pd.to_datetime(df.index, errors="coerce", utc=True)
        else:
            if df.index.tz is None:
                df.index = df.index.tz_localize("UTC")
            else:
                df.index = df.index.tz_convert("UTC")
        df.index.name = "datetime"
        return _normalize_ohlcv_frame(df), manifest
    except Exception:
        return None, None


def _cache_is_fresh(manifest: dict[str, Any], request: DataRequest) -> bool:
    fetched_at_raw = str(manifest.get("fetched_at") or "").strip()
    if not fetched_at_raw:
        return False
    fetched_at = pd.Timestamp(fetched_at_raw)
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.tz_localize("UTC")
    else:
        fetched_at = fetched_at.tz_convert("UTC")
    age = pd.Timestamp.now(tz="UTC") - fetched_at
    return age <= _freshness_limit(request)


def validate_market_data(
    request: DataRequest,
    *,
    provider_requested: str,
    provider_used: str,
    fetched_at: pd.Timestamp,
    ohlcv: pd.DataFrame,
    cache_key: str | None = None,
    cache_path: Path | None = None,
    manifest_path: Path | None = None,
    fallback_used: bool = False,
) -> tuple[pd.DataFrame, DataQualityReport]:
    normalized = _normalize_ohlcv_frame(ohlcv).copy()
    warnings: list[str] = []
    duplicates = int(normalized.index.duplicated(keep="last").sum())
    if duplicates:
        warnings.append(f"Removed {duplicates} duplicate bars.")
        normalized = normalized[~normalized.index.duplicated(keep="last")]
    normalized = normalized.astype(float)
    invalid_ohlc = normalized[
        (normalized["low"] > normalized["open"])
        | (normalized["low"] > normalized["close"])
        | (normalized["high"] < normalized["open"])
        | (normalized["high"] < normalized["close"])
        | (normalized["low"] > normalized["high"])
    ]
    if not invalid_ohlc.empty:
        report = DataQualityReport(
            status="rejected",
            summary="The dataset has inconsistent OHLC values and was rejected.",
            provider_requested=provider_requested,
            provider_used=provider_used,
            asset_class=request.asset_class,
            canonical_symbol=canonicalize_symbol(request.symbol, request.asset_class),
            requested_symbol=request.symbol,
            period=normalize_period(request.period),
            timeframe=normalize_timeframe(request.timeframe),
            fetched_at=fetched_at.isoformat(),
            freshness_status="unknown",
            coverage_status="invalid",
            rows=len(normalized),
            coverage_start=str(normalized.index.min()) if len(normalized) else None,
            coverage_end=str(normalized.index.max()) if len(normalized) else None,
            warnings=warnings,
            cache_key=cache_key,
            cache_path=str(cache_path) if cache_path else None,
            manifest_path=str(manifest_path) if manifest_path else None,
            fallback_used=fallback_used,
            blocked=True,
        )
        raise DataQualityError(report)
    if (normalized[["open", "high", "low", "close"]] <= 0).any().any():
        raise DataQualityError(
            DataQualityReport(
                status="rejected",
                summary="The dataset includes non-positive prices and was rejected.",
                provider_requested=provider_requested,
                provider_used=provider_used,
                asset_class=request.asset_class,
                canonical_symbol=canonicalize_symbol(request.symbol, request.asset_class),
                requested_symbol=request.symbol,
                period=normalize_period(request.period),
                timeframe=normalize_timeframe(request.timeframe),
                fetched_at=fetched_at.isoformat(),
                freshness_status="unknown",
                coverage_status="invalid",
                rows=len(normalized),
                coverage_start=str(normalized.index.min()) if len(normalized) else None,
                coverage_end=str(normalized.index.max()) if len(normalized) else None,
                warnings=warnings,
                cache_key=cache_key,
                cache_path=str(cache_path) if cache_path else None,
                manifest_path=str(manifest_path) if manifest_path else None,
                fallback_used=fallback_used,
                blocked=True,
            )
        )
    last_bar = normalized.index.max()
    lag = pd.Timestamp.now(tz="UTC") - last_bar
    freshness_limit = _freshness_limit(request)
    freshness_status = "fresh"
    status = "validated_high_confidence"
    summary = "Dataset passed provider and quality validation."
    if lag > freshness_limit:
        freshness_status = "stale"
        status = "insufficient_freshness"
        summary = "Dataset is too stale for the requested timeframe and quality policy."
    expected_rows = _expected_rows(request)
    actual_rows = len(normalized)
    coverage_ratio = actual_rows / max(1, expected_rows)
    coverage_status = "complete"
    if coverage_ratio < _coverage_threshold(request.coverage_requirement):
        coverage_status = "insufficient"
        status = "insufficient_coverage"
        summary = "Dataset coverage is too sparse for the requested period and timeframe."
    if fallback_used and status in QUALITY_ALLOWED:
        warnings.append(f"Used fallback provider {provider_used} after {provider_requested} was unavailable.")
        status = "validated_with_warnings"
        summary = "Dataset is usable, but it required a provider fallback."
    if coverage_ratio < 0.9 and status in QUALITY_ALLOWED:
        warnings.append(f"Coverage ratio is {coverage_ratio:.0%} of the expected bar count.")
        status = "validated_with_warnings"
        summary = "Dataset is usable, with some coverage caveats."
    if request.asset_class in {"equity", "etf"} and normalize_timeframe(request.timeframe) != "1d":
        warnings.append("Free intraday equity/ETF data can contain session gaps or provider-side adjustments.")
        if status == "validated_high_confidence":
            status = "validated_with_warnings"
            summary = "Dataset is usable, with intraday equity feed caveats."
    report = DataQualityReport(
        status=status,
        summary=summary,
        provider_requested=provider_requested,
        provider_used=provider_used,
        asset_class=request.asset_class,
        canonical_symbol=canonicalize_symbol(request.symbol, request.asset_class),
        requested_symbol=request.symbol,
        period=normalize_period(request.period),
        timeframe=normalize_timeframe(request.timeframe),
        fetched_at=fetched_at.isoformat(),
        freshness_status=freshness_status,
        coverage_status=coverage_status,
        rows=actual_rows,
        coverage_start=str(normalized.index.min()) if len(normalized) else None,
        coverage_end=str(normalized.index.max()) if len(normalized) else None,
        warnings=warnings,
        cache_key=cache_key,
        cache_path=str(cache_path) if cache_path else None,
        manifest_path=str(manifest_path) if manifest_path else None,
        fallback_used=fallback_used,
        blocked=status not in QUALITY_ALLOWED,
    )
    if request.quality_policy in {"strict_gate", "quality_labels"} and report.blocked:
        raise DataQualityError(report)
    return normalized, report


def load_market_data_snapshot(request: DataRequest, storage_dir: Path) -> MarketDataSnapshot:
    asset_class = infer_asset_class(request.symbol, request.asset_class)
    request = DataRequest(
        symbol=request.symbol,
        period=normalize_period(request.period),
        timeframe=normalize_timeframe(request.timeframe),
        asset_class=asset_class,
        provider_preference=str(request.provider_preference or "auto").strip().lower(),
        quality_policy=str(request.quality_policy or "best_effort").strip().lower(),
        freshness_requirement=str(request.freshness_requirement or "standard").strip().lower(),
        coverage_requirement=str(request.coverage_requirement or "standard").strip().lower(),
        corporate_actions_required=bool(request.corporate_actions_required),
        market=request.market,
    )
    provider_candidates = resolve_provider_candidates(request)
    last_error: str | None = None

    for provider_index, provider in enumerate(provider_candidates):
        cache_key = build_cache_key(request, provider)
        csv_path, manifest_path = _cache_paths(storage_dir, cache_key)
        cached_df, cached_manifest = _load_cached_snapshot(storage_dir, cache_key)
        if cached_df is not None and cached_manifest is not None and _cache_is_fresh(cached_manifest, request):
            try:
                normalized, report = validate_market_data(
                    request,
                    provider_requested=provider_candidates[0],
                    provider_used=provider,
                    fetched_at=pd.Timestamp(cached_manifest.get("fetched_at")).tz_convert("UTC")
                    if pd.Timestamp(cached_manifest.get("fetched_at")).tzinfo
                    else pd.Timestamp(cached_manifest.get("fetched_at")).tz_localize("UTC"),
                    ohlcv=cached_df,
                    cache_key=cache_key,
                    cache_path=csv_path,
                    manifest_path=manifest_path,
                    fallback_used=provider_index > 0,
                )
                eq, et = None, None
                return MarketDataSnapshot(
                    symbol=request.symbol,
                    canonical_symbol=canonicalize_symbol(request.symbol, request.asset_class),
                    asset_class=request.asset_class,
                    provider_used=provider,
                    period=request.period,
                    timeframe=request.timeframe,
                    ohlcv=normalized,
                    quality=report,
                    execution_quotes=eq,
                    execution_trades=et,
                )
            except DataQualityError as exc:
                last_error = exc.report.get("summary", str(exc))
        try:
            fetched_at = pd.Timestamp.now(tz="UTC")
            fetched = fetch_ohlcv_from_provider(provider, request)
            if fetched.empty:
                last_error = f"No data from provider {provider}"
                continue
            normalized, report = validate_market_data(
                request,
                provider_requested=provider_candidates[0],
                provider_used=provider,
                fetched_at=fetched_at,
                ohlcv=fetched,
                cache_key=cache_key,
                cache_path=csv_path,
                manifest_path=manifest_path,
                fallback_used=provider_index > 0,
            )
            csv_path.parent.mkdir(parents=True, exist_ok=True)
            normalized.to_csv(csv_path)
            manifest_path.write_text(json.dumps(report.to_dict(), indent=2))
            eq, et = None, None
            return MarketDataSnapshot(
                symbol=request.symbol,
                canonical_symbol=canonicalize_symbol(request.symbol, request.asset_class),
                asset_class=request.asset_class,
                provider_used=provider,
                period=request.period,
                timeframe=request.timeframe,
                ohlcv=normalized,
                quality=report,
                execution_quotes=eq,
                execution_trades=et,
            )
        except DataQualityError as exc:
            last_error = exc.report.get("summary", str(exc))
            if request.quality_policy in {"strict_gate", "quality_labels"}:
                raise
        except Exception as exc:
            last_error = str(exc)
            continue
    raise DataQualityError(
        {
            "status": "rejected",
            "summary": last_error or "No provider returned a usable dataset.",
            "provider_requested": provider_candidates[0] if provider_candidates else request.provider_preference,
            "provider_used": provider_candidates[-1] if provider_candidates else request.provider_preference,
            "asset_class": request.asset_class,
            "canonical_symbol": canonicalize_symbol(request.symbol, request.asset_class),
            "requested_symbol": request.symbol,
            "period": request.period,
            "timeframe": request.timeframe,
            "fetched_at": pd.Timestamp.now(tz="UTC").isoformat(),
            "freshness_status": "unknown",
            "coverage_status": "unknown",
            "rows": 0,
            "coverage_start": None,
            "coverage_end": None,
            "warnings": [last_error] if last_error else [],
            "validation_version": DATA_VALIDATION_VERSION,
            "blocked": True,
        }
    )


def load_market_data_bundle(
    symbols: list[str],
    *,
    period: str,
    timeframe: str,
    asset_class: str,
    provider_preference: str,
    quality_policy: str,
    freshness_requirement: str,
    coverage_requirement: str,
    corporate_actions_required: bool,
    market: str | None,
    storage_dir: Path,
) -> dict[str, MarketDataSnapshot]:
    snapshots: dict[str, MarketDataSnapshot] = {}
    errors: list[dict[str, Any]] = []
    for symbol in symbols:
        request = DataRequest(
            symbol=symbol,
            period=period,
            timeframe=timeframe,
            asset_class=asset_class,
            provider_preference=provider_preference,
            quality_policy=quality_policy,
            freshness_requirement=freshness_requirement,
            coverage_requirement=coverage_requirement,
            corporate_actions_required=corporate_actions_required,
            market=market,
        )
        try:
            snapshot = load_market_data_snapshot(request, storage_dir)
            snapshots[symbol] = snapshot
        except DataQualityError as exc:
            errors.append(exc.report)
    if errors and quality_policy in {"strict_gate", "quality_labels"}:
        raise DataQualityError(
            {
                "status": "rejected",
                "summary": "One or more requested symbols did not pass the market-data quality policy.",
                "provider_requested": provider_preference,
                "provider_used": provider_preference,
                "asset_class": asset_class,
                "canonical_symbol": ",".join(canonicalize_symbol(symbol, infer_asset_class(symbol, asset_class)) for symbol in symbols),
                "requested_symbol": ",".join(symbols),
                "period": period,
                "timeframe": timeframe,
                "fetched_at": pd.Timestamp.now(tz="UTC").isoformat(),
                "freshness_status": "mixed",
                "coverage_status": "mixed",
                "rows": sum(int(error.get("rows", 0)) for error in errors),
                "coverage_start": None,
                "coverage_end": None,
                "warnings": [error.get("summary", "") for error in errors if error.get("summary")],
                "validation_version": DATA_VALIDATION_VERSION,
                "blocked": True,
                "symbol_errors": errors,
            }
        )
    if not snapshots:
        raise DataQualityError(
            {
                "status": "rejected",
                "summary": "No symbols produced a usable dataset.",
                "provider_requested": provider_preference,
                "provider_used": provider_preference,
                "asset_class": asset_class,
                "canonical_symbol": ",".join(symbols),
                "requested_symbol": ",".join(symbols),
                "period": period,
                "timeframe": timeframe,
                "fetched_at": pd.Timestamp.now(tz="UTC").isoformat(),
                "freshness_status": "unknown",
                "coverage_status": "unknown",
                "rows": 0,
                "coverage_start": None,
                "coverage_end": None,
                "warnings": [error.get("summary", "") for error in errors if error.get("summary")],
                "validation_version": DATA_VALIDATION_VERSION,
                "blocked": True,
            }
        )
    return snapshots


# ---------------------------------------------------------------------------
# Oracoli on-chain (interfacce + mock) — Chainlink / Pyth style per simulazioni DEX
# ---------------------------------------------------------------------------


class OraclePriceFeed:
    """Protocollo minimale: mid price con possibile staleness (blocchi)."""

    def read_mid(self, symbol: str) -> float:
        raise NotImplementedError

    def staleness_blocks(self) -> int:
        return 0


class MockChainlinkStyleOracle(OraclePriceFeed):
    """Mock Chainlink: ritardo fisso + piccolo bias deterministico."""

    def __init__(self, *, stale_blocks: int = 1, bias_bps: float = 2.0) -> None:
        self._stale = max(0, int(stale_blocks))
        self._bias = float(bias_bps)

    def read_mid(self, symbol: str) -> float:
        s = str(symbol or "UNKNOWN").encode("utf-8")
        base = 100.0 + (sum(s) % 50)
        return base * (1.0 + self._bias / 10_000.0)

    def staleness_blocks(self) -> int:
        return self._stale


class MockPythStyleOracle(OraclePriceFeed):
    """Mock Pyth: confidence band implicita via jitter sul mid."""

    def __init__(self, *, stale_blocks: int = 0, jitter_bps: float = 3.0) -> None:
        self._stale = max(0, int(stale_blocks))
        self._jitter = float(jitter_bps)

    def read_mid(self, symbol: str) -> float:
        s = str(symbol or "X").encode("utf-8")
        base = 50.0 + (sum(s) % 30)
        jitter = (sum(s) % 7 - 3) * (self._jitter / 10_000.0)
        return base * (1.0 + jitter)

    def staleness_blocks(self) -> int:
        return self._stale


def default_onchain_oracle_bundle() -> tuple[MockChainlinkStyleOracle, MockPythStyleOracle]:
    """Coppia mock usabile dai test o da wrapper che arricchiscono ProgramMetadata."""
    return MockChainlinkStyleOracle(stale_blocks=1, bias_bps=2.5), MockPythStyleOracle(stale_blocks=0, jitter_bps=4.0)


def suggested_dex_execution_overhead(
    *,
    symbol: str,
    chainlink: OraclePriceFeed | None = None,
    pyth: OraclePriceFeed | None = None,
) -> dict[str, float | int]:
    """
    Euristica per LPFT-META / backtest: latenza in barre e spread sintetico DEX (bps).
    Non chiama rete; i mock servono a rendere esplicito il gap vs dati Web2 perfetti.
    """
    cl = chainlink or MockChainlinkStyleOracle()
    py = pyth or MockPythStyleOracle()
    stale = max(cl.staleness_blocks(), py.staleness_blocks())
    ac = infer_asset_class(symbol, None)
    base_spread = 6.0 if ac == "crypto" else 4.0
    return {
        "onchain_latency_bars": int(stale),
        "dex_synthetic_spread_bps": float(base_spread + abs(hash(symbol)) % 5),
    }


if __name__ == "__main__":
    import sys

    sym = sys.argv[1] if len(sys.argv) > 1 else "AAPL"
    req = DataRequest(symbol=sym, period="1y", timeframe="1d", asset_class="equity", provider_preference="yahoo")
    df = _fetch_yahoo(req)
    print(json.dumps({"symbol": sym, "rows": int(len(df))}, indent=2))
