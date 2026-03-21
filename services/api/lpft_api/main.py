from __future__ import annotations

import json as _json
import re
import shutil
import uuid
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from sqlmodel import Session, select

from lpft_api.assistant import build_strategy_prompt, plan_assistant_turn, stream_answer
from lpft_api.capabilities import CapabilityStatus, assess_strategy_spec
from lpft_api.config import settings
from lpft_api.db import Run, RunStatus, RunType, Strategy, engine, init_db
from lpft_api.dsl import StrategySpec
from lpft_api.llm import generate_strategy_spec, generate_strategy_spec_stream
from lpft_api.inline_backtest import run_generate_signals, run_inline_backtest
from lpft_api.program_llm import generate_program, repair_program
from lpft_api.queue import get_queue
from lpft_shared.engine import build_validation_ohlcv, extract_program_metadata, write_validation_artifact
from lpft_shared.market_data import (
    DataQualityError,
    DataRequest,
    canonicalize_symbol,
    load_market_data_bundle,
    load_market_data_snapshot,
    normalize_period,
)
from lpft_api.schemas import (
    AssistantStreamRequest,
    DatasetFetchResponse,
    DatasetUploadResponse,
    GenerateAndBacktestRequest,
    GenerateAndBacktestResponse,
    GeneratedProgram,
    GenerateProgramRequest,
    GenerateProgramResponse,
    GenerateStrategyRequest,
    GenerateStrategyResponse,
    RunCreate,
    RunOut,
    RunProgramRequest,
    RunProgramResponse,
    StrategyCreate,
    StrategyOut,
)

app = FastAPI(title="LPFT API", version="0.1.0")

CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
]
# Accetta origin tipici di sviluppo locale:
# localhost, 127.0.0.1, 0.0.0.0 e IP privati LAN con qualsiasi porta.
_CORS_ORIGIN_REGEX = re.compile(
    r"^http://("
    r"localhost|"
    r"127\.0\.0\.1|"
    r"0\.0\.0\.0|"
    r"10(?:\.\d{1,3}){3}|"
    r"192\.168(?:\.\d{1,3}){2}|"
    r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
    r")(:\d+)?$",
    re.IGNORECASE,
)


def _is_allowed_origin(origin: str | None) -> bool:
    if not origin:
        return False
    origin = origin.strip().rstrip("/")
    if origin in CORS_ORIGINS:
        return True
    return _CORS_ORIGIN_REGEX.fullmatch(origin) is not None


def _cors_headers(origin: str | None) -> dict:
    allow_origin = origin if origin and _is_allowed_origin(origin) else CORS_ORIGINS[0]
    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Max-Age": "86400",
    }


@app.options("/{path:path}")
async def options_cors(path: str, request: Request):
    """Risponde al preflight OPTIONS con 200 e header CORS."""
    origin = request.headers.get("origin")
    return Response(status_code=200, headers=_cors_headers(origin))


class PreflightMiddleware(BaseHTTPMiddleware):
    """Risponde alle richieste OPTIONS (preflight) con 200 e header CORS."""

    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return Response(status_code=200, headers=_cors_headers(request.headers.get("origin")))
        return await call_next(request)


class AddCorsToAllResponsesMiddleware(BaseHTTPMiddleware):
    """Aggiunge header CORS a ogni risposta (inclusi errori 500) così il browser non blocca."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        origin = request.headers.get("origin")
        for key, value in _cors_headers(origin).items():
            response.headers[key] = value
        return response


# Regex che accetta origin di sviluppo locale/LAN con qualsiasi porta (es. :3000)
CORS_ORIGIN_REGEX = (
    r"http://("
    r"localhost|"
    r"127\.0\.0\.1|"
    r"0\.0\.0\.0|"
    r"10(?:\.\d{1,3}){3}|"
    r"192\.168(?:\.\d{1,3}){2}|"
    r"172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}"
    r")(:\d+)?$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],  # usiamo solo allow_origin_regex
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"],
    allow_headers=["*"],
    expose_headers=["*"],
)
app.add_middleware(PreflightMiddleware)
app.add_middleware(AddCorsToAllResponsesMiddleware)


@app.on_event("startup")
def on_startup():
    init_db()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Restituisce 500 con CORS così il browser non blocca. HTTPException la gestisce FastAPI."""
    if isinstance(exc, HTTPException):
        raise exc
    origin = request.headers.get("origin")
    headers = _cors_headers(origin)
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers=headers,
    )


def _safe_filename(name: str) -> bool:
    if not name or ".." in name or "/" in name or "\\" in name:
        return False
    return True


@app.get("/")
def root():
    return {"status": "ok"}


@app.get("/datasets/files/{filename}", response_class=FileResponse)
def get_dataset_file(filename: str):
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = Path(settings.storage_dir) / "datasets" / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(file_path), filename=filename)


@app.post("/strategies", response_model=StrategyOut)
def create_strategy(body: StrategyCreate):
    with Session(engine) as session:
        strategy = Strategy(name=body.name, spec=body.spec.model_dump())
        session.add(strategy)
        session.commit()
        session.refresh(strategy)
        return StrategyOut(id=strategy.id, name=strategy.name, spec=strategy.spec)


@app.get("/strategies", response_model=list[StrategyOut])
def list_strategies():
    with Session(engine) as session:
        strategies = list(session.exec(select(Strategy)))
        return [StrategyOut(id=s.id, name=s.name, spec=s.spec) for s in strategies]


@app.post("/runs", response_model=RunOut)
def create_run(body: RunCreate):
    with Session(engine) as session:
        run = Run(
            strategy_id=body.strategy_id,
            run_type=body.run_type,
            period=body.period,
            timeframe=body.timeframe,
            symbol=body.symbol,
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return _run_out(run)


@app.get("/runs", response_model=list[RunOut])
def list_runs():
    with Session(engine) as session:
        runs = list(session.exec(select(Run).order_by(Run.id.desc())))
        return [_run_out(r) for r in runs]


@app.get("/runs/{run_id}", response_model=RunOut)
def get_run(run_id: int):
    with Session(engine) as session:
        run = session.get(Run, run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        return _run_out(run)


def _run_out(r: Run) -> RunOut:
    return RunOut(
        id=r.id,
        strategy_id=r.strategy_id,
        status=r.status,
        run_type=r.run_type,
        program_code=r.program_code,
        period=r.period,
        timeframe=r.timeframe,
        symbol=r.symbol,
        created_at=r.created_at.isoformat() if r.created_at else "",
        error=r.error,
    )


def _check_anthropic_key():
    if not (getattr(settings, "anthropic_api_key", None) or "").strip():
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY non configurata. Imposta la variabile d'ambiente LPFT_ANTHROPIC_API_KEY e riavvia l'API.",
        )


def _timeframe_from_spec(spec: StrategySpec, fallback: str = "1d") -> str:
    """Bar interval for OHLCV load: always taken from the strategy spec once generated."""
    tf = spec.universe.timeframe
    raw = getattr(tf, "value", str(tf)) if tf is not None else ""
    cleaned = str(raw or "").strip()
    return cleaned if cleaned else (fallback or "1d")


def _period_from_spec(spec: StrategySpec, fallback: str = "1y") -> str:
    """Lookback storico per OHLCV (1m…5y): da data.history_period se valorizzato, altrimenti fallback (es. richiesta client)."""
    hp = spec.data.history_period
    if hp is None:
        return fallback or "1y"
    raw = getattr(hp, "value", str(hp))
    try:
        return normalize_period(str(raw))
    except ValueError:
        return fallback or "1y"


def _generate_valid_program(strategy_spec, *, symbol: str, timeframe: str) -> tuple[str, dict]:
    code = generate_program(strategy_spec)
    sample = build_validation_ohlcv(timeframe or "1d")
    validation = {
        "status": "valid",
        "summary": "The compiled strategy passed shared-engine preflight validation.",
        "warnings": [],
    }
    try:
        run_generate_signals(code, sample)
        return code, validation
    except Exception as e:
        validation["warnings"].append(str(e))
        if getattr(strategy_spec.kind, "value", str(strategy_spec.kind)) != "python":
            validation["status"] = "invalid"
            validation["summary"] = "The deterministic strategy failed the shared-engine preflight validation."
            raise
        repaired = repair_program(strategy_spec, code, str(e))
        run_generate_signals(repaired, sample)
        validation["summary"] = "The custom Python strategy needed one repair pass before validation."
        return repaired, validation


def _preflight_market_data(program_code: str, *, symbol: str, period: str, timeframe: str) -> dict:
    metadata = extract_program_metadata(program_code)
    symbols = metadata.symbols or [symbol or "AAPL"]
    snapshots = load_market_data_bundle(
        symbols,
        period=period or "1y",
        timeframe=timeframe or metadata.timeframe or "1d",
        asset_class=metadata.asset_class,
        provider_preference=metadata.provider_preference,
        quality_policy=metadata.quality_policy,
        freshness_requirement=metadata.freshness_requirement,
        coverage_requirement=metadata.coverage_requirement,
        corporate_actions_required=metadata.corporate_actions_required,
        market=metadata.market,
        storage_dir=Path(settings.storage_dir),
    )
    data_sources = [snapshot.quality.to_dict() for snapshot in snapshots.values()]
    overall_status = "validated_high_confidence"
    if any(source.get("status") == "validated_with_warnings" for source in data_sources):
        overall_status = "validated_with_warnings"
    return {
        "status": overall_status,
        "summary": "Market data passed strategy-aware quality validation.",
        "warnings": [warning for source in data_sources for warning in source.get("warnings", [])],
        "data_sources": data_sources,
    }


def _inline_complete_run(run_id: int, *, symbol: str, period: str, timeframe: str, program_code: str) -> None:
    try:
        with Session(engine) as session:
            run = session.get(Run, run_id)
            if run:
                run.status = RunStatus.running
                run.error = None
                session.add(run)
                session.commit()
        output_dir = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}"
        run_inline_backtest(
            symbol=symbol or "AAPL",
            period=period or "1y",
            timeframe=timeframe or "1d",
            program_code=program_code,
            output_dir=output_dir,
            storage_dir=Path(settings.storage_dir),
        )
        with Session(engine) as session:
            run = session.get(Run, run_id)
            if run:
                run.status = RunStatus.completed
                run.error = None
                session.add(run)
                session.commit()
    except Exception as e:
        if isinstance(e, DataQualityError):
            metadata = extract_program_metadata(program_code)
            write_validation_artifact(
                Path(settings.storage_dir) / "artifacts" / f"run_{run_id}",
                {
                    "status": "rejected",
                    "engine_version": metadata.engine_version,
                    "artifact_type": metadata.artifact_type,
                    "strategy_kind": metadata.strategy_kind,
                    "position_mode": metadata.position_mode,
                    "symbols_requested": metadata.symbols,
                    "symbols_used": [],
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
                    "data_error": e.report,
                },
                program_code,
            )
        with Session(engine) as session:
            run = session.get(Run, run_id)
            if run:
                run.status = RunStatus.failed
                run.error = e.report.get("summary", str(e)) if isinstance(e, DataQualityError) else str(e)
                session.add(run)
                session.commit()


def _enqueue_backtest_with_fallback(run_id: int, *, symbol: str, period: str, timeframe: str, program_code: str) -> None:
    try:
        q = get_queue()
        q.enqueue("lpft_worker.jobs.run_backtest_job", run_id, job_id=f"run_{run_id}")
    except Exception:
        _inline_complete_run(
            run_id,
            symbol=symbol,
            period=period,
            timeframe=timeframe,
            program_code=program_code,
        )


def _create_program_run(*, program_code: str, symbol: str, period: str, timeframe: str) -> int:
    with Session(engine) as session:
        run = Run(
            strategy_id=None,
            run_type=RunType.backtest,
            status=RunStatus.pending,
            program_code=program_code,
            period=period,
            timeframe=timeframe,
            symbol=symbol,
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return int(run.id)


def _stream_generate_strategy(description: str, origin: str | None):
    """Generator SSE: eventi data con type=reasoning chunk o type=spec."""
    try:
        for chunk, spec in generate_strategy_spec_stream(description):
            if chunk is not None:
                yield f"data: {_json.dumps({'type': 'reasoning', 'chunk': chunk})}\n\n"
            elif spec is not None:
                yield f"data: {_json.dumps({'type': 'spec', 'spec': spec.model_dump()})}\n\n"
    except Exception as e:
        yield f"data: {_json.dumps({'type': 'error', 'detail': str(e)})}\n\n"


@app.post("/generate-strategy-stream")
def api_generate_strategy_stream(request: Request, body: GenerateStrategyRequest):
    """Streaming: invia chunk di ragionamento in tempo reale, poi lo spec JSON."""
    _check_anthropic_key()
    headers = {
        **_cors_headers(request.headers.get("origin")),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        _stream_generate_strategy(body.description, request.headers.get("origin")),
        headers=headers,
        media_type="text/event-stream",
    )


def _stream_assistant(body: AssistantStreamRequest):
    try:
        try:
            plan = plan_assistant_turn(
                body.messages,
                current_run_id=body.current_run_id,
                current_code=body.current_code,
                current_spec=body.current_spec,
                symbol=body.symbol,
                period=body.period,
                timeframe=body.timeframe,
            )
        except Exception:
            for chunk in stream_answer(
                body.messages,
                current_run_id=body.current_run_id,
                current_code=body.current_code,
                current_spec=body.current_spec,
                symbol=body.symbol,
                period=body.period,
                timeframe=body.timeframe,
            ):
                if chunk:
                    yield f"data: {_json.dumps({'type': 'assistant', 'chunk': chunk})}\n\n"
            yield f"data: {_json.dumps({'type': 'done'})}\n\n"
            return

        if plan.mode == "clarify":
            if plan.assistant_reply:
                yield f"data: {_json.dumps({'type': 'assistant', 'chunk': plan.assistant_reply})}\n\n"
            yield f"data: {_json.dumps({'type': 'clarification', 'question': plan.clarification_question or 'Which direction should I take?', 'options': plan.clarification_options or ['Explain the market idea', 'Build a strategy', 'Improve existing logic'], 'summary': plan.clarification_summary or [], 'missing': plan.clarification_missing or []})}\n\n"
            yield f"data: {_json.dumps({'type': 'done'})}\n\n"
            return

        if plan.mode in {"answer", "analyze"}:
            for chunk in stream_answer(
                body.messages,
                current_run_id=body.current_run_id,
                current_code=body.current_code,
                current_spec=body.current_spec,
                symbol=body.symbol,
                period=body.period,
                timeframe=body.timeframe,
                analysis_prompt=plan.analysis_prompt,
            ):
                if chunk:
                    yield f"data: {_json.dumps({'type': 'assistant', 'chunk': chunk})}\n\n"
            yield f"data: {_json.dumps({'type': 'done'})}\n\n"
            return

        if plan.assistant_reply:
            yield f"data: {_json.dumps({'type': 'assistant', 'chunk': plan.assistant_reply})}\n\n"

        strategy_prompt = build_strategy_prompt(
            plan,
            body.messages,
            current_code=body.current_code,
            current_spec=body.current_spec,
            current_run_id=body.current_run_id,
            symbol=body.symbol,
            period=body.period,
            timeframe=body.timeframe,
        )

        spec = None
        for chunk, maybe_spec in generate_strategy_spec_stream(strategy_prompt):
            if chunk is not None:
                yield f"data: {_json.dumps({'type': 'reasoning', 'chunk': chunk})}\n\n"
            elif maybe_spec is not None:
                spec = maybe_spec
                yield f"data: {_json.dumps({'type': 'spec', 'spec': spec.model_dump()})}\n\n"

        if spec is None:
            raise ValueError("Strategy generation did not return a valid spec")

        capability = assess_strategy_spec(spec)
        yield f"data: {_json.dumps({'type': 'capability', 'capability': capability.model_dump()})}\n\n"
        if capability.status in {
            CapabilityStatus.unsupported_missing_data,
            CapabilityStatus.unsupported_with_conversion_path,
        }:
            yield f"data: {_json.dumps({'type': 'unsupported_strategy', 'detail': capability.summary, 'missing_requirements': capability.missing_requirements, 'conversion_suggestions': capability.conversion_suggestions, 'warnings': capability.warnings})}\n\n"
            yield f"data: {_json.dumps({'type': 'done'})}\n\n"
            return

        backtest_timeframe = _timeframe_from_spec(spec, body.timeframe or "1d")
        backtest_period = _period_from_spec(spec, body.period or "1y")
        code, validation = _generate_valid_program(
            spec,
            symbol=body.symbol or "AAPL",
            timeframe=backtest_timeframe,
        )
        validation["warnings"] = list(dict.fromkeys([*capability.warnings, *validation.get("warnings", [])]))
        if plan.should_backtest:
            try:
                data_validation = _preflight_market_data(
                    code,
                    symbol=body.symbol or "AAPL",
                    period=backtest_period,
                    timeframe=backtest_timeframe,
                )
            except DataQualityError as exc:
                yield f"data: {_json.dumps({'type': 'validation', 'validation': {'status': 'invalid', 'summary': exc.report.get('summary', 'Market data quality rejected'), 'warnings': exc.report.get('warnings', []), 'data_sources': exc.report.get('symbol_errors', []) or [exc.report]}})}\n\n"
                yield f"data: {_json.dumps({'type': 'unsupported_strategy', 'detail': exc.report.get('summary', 'Market data quality rejected'), 'missing_requirements': [], 'conversion_suggestions': ['Try daily bars', 'Use a different symbol', 'Reduce the lookback range'], 'warnings': exc.report.get('warnings', [])})}\n\n"
                yield f"data: {_json.dumps({'type': 'done'})}\n\n"
                return
            validation["status"] = data_validation["status"]
            validation["summary"] = data_validation["summary"]
            validation["warnings"] = list(dict.fromkeys([*validation.get("warnings", []), *data_validation.get("warnings", [])]))
            validation["data_sources"] = data_validation.get("data_sources", [])
        yield f"data: {_json.dumps({'type': 'validation', 'validation': validation})}\n\n"
        yield f"data: {_json.dumps({'type': 'code', 'code': code})}\n\n"

        if plan.should_backtest:
            run_id = _create_program_run(
                program_code=code,
                symbol=body.symbol or "AAPL",
                period=backtest_period,
                timeframe=backtest_timeframe,
            )
            _enqueue_backtest_with_fallback(
                run_id,
                symbol=body.symbol or "AAPL",
                period=backtest_period,
                timeframe=backtest_timeframe,
                program_code=code,
            )
            yield f"data: {_json.dumps({'type': 'run_status', 'run_id': run_id, 'status': 'pending'})}\n\n"
            yield f"data: {_json.dumps({'type': 'run', 'run_id': run_id, 'code': code, 'spec': spec.model_dump(), 'params': {'symbol': body.symbol or 'AAPL', 'period': backtest_period, 'timeframe': backtest_timeframe}})}\n\n"

        yield f"data: {_json.dumps({'type': 'done'})}\n\n"
    except Exception as e:
        yield f"data: {_json.dumps({'type': 'error', 'detail': str(e)})}\n\n"


@app.post("/assistant/stream")
def api_assistant_stream(request: Request, body: AssistantStreamRequest):
    _check_anthropic_key()
    headers = {
        **_cors_headers(request.headers.get("origin")),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(
        _stream_assistant(body),
        headers=headers,
        media_type="text/event-stream",
    )


@app.post("/generate-strategy", response_model=GenerateStrategyResponse)
def api_generate_strategy(request: Request, body: GenerateStrategyRequest):
    _check_anthropic_key()
    try:
        spec = generate_strategy_spec(body.description)
        return GenerateStrategyResponse(spec=spec)
    except HTTPException:
        raise
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"detail": str(e)},
            headers=_cors_headers(request.headers.get("origin")),
        )


@app.post("/generate-program", response_model=GenerateProgramResponse)
def api_generate_program(body: GenerateProgramRequest):
    capability = assess_strategy_spec(body.strategy_spec)
    if capability.status in {
        CapabilityStatus.unsupported_missing_data,
        CapabilityStatus.unsupported_with_conversion_path,
    }:
        raise HTTPException(status_code=400, detail=capability.summary)
    code, _validation = _generate_valid_program(
        body.strategy_spec,
        symbol=(body.strategy_spec.universe.symbols[0] if body.strategy_spec.universe.symbols else "AAPL"),
        timeframe=body.strategy_spec.universe.timeframe.value if hasattr(body.strategy_spec.universe.timeframe, "value") else str(body.strategy_spec.universe.timeframe),
    )
    return GenerateProgramResponse(program=GeneratedProgram(code=code, language="python"))


@app.post("/generate-and-backtest", response_model=GenerateAndBacktestResponse)
def api_generate_and_backtest(request: Request, body: GenerateAndBacktestRequest):
    _check_anthropic_key()
    try:
        capability = assess_strategy_spec(body.strategy_spec)
        if capability.status in {
            CapabilityStatus.unsupported_missing_data,
            CapabilityStatus.unsupported_with_conversion_path,
        }:
            raise HTTPException(status_code=400, detail=capability.summary)
        backtest_timeframe = _timeframe_from_spec(body.strategy_spec, body.timeframe or "1d")
        backtest_period = _period_from_spec(body.strategy_spec, body.period or "1y")
        code, _validation = _generate_valid_program(
            body.strategy_spec,
            symbol=body.symbol or "AAPL",
            timeframe=backtest_timeframe,
        )
        _preflight_market_data(
            code,
            symbol=body.symbol or "AAPL",
            period=backtest_period,
            timeframe=backtest_timeframe,
        )
        run_id = _create_program_run(
            program_code=code,
            symbol=body.symbol,
            period=backtest_period,
            timeframe=backtest_timeframe,
        )
        _enqueue_backtest_with_fallback(
            run_id,
            symbol=body.symbol or "AAPL",
            period=backtest_period,
            timeframe=backtest_timeframe,
            program_code=code,
        )
        return GenerateAndBacktestResponse(run_id=run_id, program_code=code)
    except HTTPException:
        raise
    except DataQualityError as e:
        return JSONResponse(
            status_code=400,
            content={"detail": e.report.get("summary", "Market data quality rejected")},
            headers=_cors_headers(request.headers.get("origin")),
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"detail": str(e)},
            headers=_cors_headers(request.headers.get("origin")),
        )


@app.post("/runs/program", response_model=RunProgramResponse)
def run_program(body: RunProgramRequest):
    with Session(engine) as session:
        run = session.get(Run, body.run_id)
        if not run:
            raise HTTPException(status_code=404, detail="Run not found")
        if run.program_code is None:
            raise HTTPException(status_code=400, detail="Run has no program code")
        try:
            _preflight_market_data(
                run.program_code,
                symbol=run.symbol or "AAPL",
                period=run.period or "1y",
                timeframe=run.timeframe or "1d",
            )
        except DataQualityError as exc:
            write_validation_artifact(
                Path(settings.storage_dir) / "artifacts" / f"run_{body.run_id}",
                {
                    "status": "rejected",
                    "summary": exc.report.get("summary", "Market data quality rejected"),
                    "data_error": exc.report,
                },
                run.program_code or "",
            )
            run.status = RunStatus.failed
            run.error = exc.report.get("summary", "Market data quality rejected")
            session.add(run)
            session.commit()
            raise HTTPException(status_code=400, detail=run.error)
        run.status = RunStatus.pending
        run.error = None
        session.add(run)
        session.commit()
    try:
        q = get_queue()
        q.enqueue("lpft_worker.jobs.run_backtest_job", body.run_id, job_id=f"run_{body.run_id}")
    except Exception:
        with Session(engine) as session:
            run = session.get(Run, body.run_id)
            if not run:
                raise HTTPException(status_code=404, detail="Run not found")
            symbol = run.symbol or "AAPL"
            period = run.period or "1y"
            timeframe = run.timeframe or "1d"
            code = run.program_code or ""
        _inline_complete_run(
            body.run_id,
            symbol=symbol,
            period=period,
            timeframe=timeframe,
            program_code=code,
        )
    return RunProgramResponse(run_id=body.run_id, status=RunStatus.pending)


@app.get("/runs/{run_id}/artifacts")
def list_artifacts(run_id: int):
    art_dir = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}"
    if not art_dir.is_dir():
        return []
    return [f.name for f in art_dir.iterdir() if f.is_file()]


@app.get("/runs/{run_id}/artifacts/{filename}", response_class=FileResponse)
def get_artifact(run_id: int, filename: str):
    if not _safe_filename(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}" / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path=str(file_path), filename=filename)


@app.post("/datasets/upload", response_model=DatasetUploadResponse)
async def upload_dataset(file: UploadFile):
    datasets_dir = Path(settings.storage_dir) / "datasets"
    datasets_dir.mkdir(parents=True, exist_ok=True)
    base = file.filename or "upload"
    stem, suffix = base.rsplit(".", 1) if "." in base else (base, "")
    filename = f"{stem}_{uuid.uuid4().hex[:8]}.{suffix}" if suffix else f"{stem}_{uuid.uuid4().hex[:8]}"
    path = datasets_dir / filename
    with open(path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return DatasetUploadResponse(filename=filename, path=str(path))


@app.post("/datasets/fetch", response_model=DatasetFetchResponse)
def fetch_dataset(
    symbol: str = "AAPL",
    period: str = "1y",
    interval: str = "1d",
    asset_class: str = "auto",
    provider_preference: str = "auto",
    quality_policy: str = "best_effort",
):
    try:
        snapshot = load_market_data_snapshot(
            DataRequest(
                symbol=symbol,
                period=period,
                timeframe=interval,
                asset_class=asset_class,
                provider_preference=provider_preference,
                quality_policy=quality_policy,
            ),
            Path(settings.storage_dir),
        )
    except DataQualityError as exc:
        raise HTTPException(status_code=400, detail=exc.report.get("summary", "No data for symbol/period")) from exc
    return DatasetFetchResponse(
        symbol=snapshot.canonical_symbol,
        period=period,
        interval=interval,
        rows=len(snapshot.ohlcv),
        path=snapshot.quality.cache_path,
        provider_used=snapshot.provider_used,
        asset_class=snapshot.asset_class,
        quality_status=snapshot.quality.status,
        freshness_status=snapshot.quality.freshness_status,
        coverage_status=snapshot.quality.coverage_status,
        warnings=snapshot.quality.warnings,
    )
