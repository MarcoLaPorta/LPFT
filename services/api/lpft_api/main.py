from __future__ import annotations

import json as _json
import re
import shutil
import uuid
from pathlib import Path
import threading
import time

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from sqlmodel import Session, select

from lpft_api.config import settings
from lpft_api.db import Run, RunStatus, RunType, Strategy, engine, init_db
from lpft_api.llm import generate_strategy_spec, generate_strategy_spec_stream
from lpft_api.market_data import dataset_path, fetch_ohlcv_yahoo
from lpft_api.inline_backtest import run_inline_backtest
from lpft_api.program_llm import generate_program
from lpft_api.queue import get_queue
from lpft_api.schemas import (
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

CORS_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]
# Accetta localhost / 127.0.0.1 con qualsiasi porta
_CORS_ORIGIN_REGEX = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", re.IGNORECASE)


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


# Regex che accetta http://localhost e http://127.0.0.1 con qualsiasi porta (es. :3000)
CORS_ORIGIN_REGEX = r"http://(localhost|127\.0\.0\.1)(:\d+)?$"

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
    code = generate_program(body.strategy_spec)
    return GenerateProgramResponse(program=GeneratedProgram(code=code, language="python"))


@app.post("/generate-and-backtest", response_model=GenerateAndBacktestResponse)
def api_generate_and_backtest(request: Request, body: GenerateAndBacktestRequest):
    _check_anthropic_key()
    try:
        code = generate_program(body.strategy_spec)
        with Session(engine) as session:
            run = Run(
                strategy_id=None,
                run_type=RunType.backtest,
                status=RunStatus.pending,
                program_code=code,
                period=body.period,
                timeframe=body.timeframe,
                symbol=body.symbol,
            )
            session.add(run)
            session.commit()
            session.refresh(run)
            run_id = run.id
        def _inline_finish_if_stuck() -> None:
            # Se Redis c'è ma il worker no, l'enqueue riesce ma il run resta pending.
            # Dopo un breve delay, se è ancora pending, eseguiamo inline.
            time.sleep(3.0)
            with Session(engine) as session:
                run = session.get(Run, run_id)
                if not run or run.status != RunStatus.pending:
                    return
                run.status = RunStatus.running
                run.error = None
                session.add(run)
                session.commit()
            try:
                output_dir = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}"
                run_inline_backtest(
                    symbol=body.symbol or "AAPL",
                    period=body.period or "1y",
                    timeframe=body.timeframe or "1d",
                    program_code=code,
                    output_dir=output_dir,
                )
                with Session(engine) as session:
                    run = session.get(Run, run_id)
                    if run:
                        run.status = RunStatus.completed
                        run.error = None
                        session.add(run)
                        session.commit()
            except Exception as e:
                with Session(engine) as session:
                    run = session.get(Run, run_id)
                    if run:
                        run.status = RunStatus.failed
                        run.error = str(e)
                        session.add(run)
                        session.commit()

        try:
            q = get_queue()
            q.enqueue("lpft_worker.jobs.run_backtest_job", run_id, job_id=f"run_{run_id}")
            threading.Thread(target=_inline_finish_if_stuck, daemon=True).start()
        except Exception:
            # Fallback: esegui inline (senza Redis/worker) così la UI funziona sempre.
            with Session(engine) as session:
                run = session.get(Run, run_id)
                if run:
                    run.status = RunStatus.running
                    run.error = None
                    session.add(run)
                    session.commit()
            try:
                output_dir = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}"
                run_inline_backtest(
                    symbol=body.symbol or "AAPL",
                    period=body.period or "1y",
                    timeframe=body.timeframe or "1d",
                    program_code=code,
                    output_dir=output_dir,
                )
                with Session(engine) as session:
                    run = session.get(Run, run_id)
                    if run:
                        run.status = RunStatus.completed
                        run.error = None
                        session.add(run)
                        session.commit()
            except Exception as e:
                with Session(engine) as session:
                    run = session.get(Run, run_id)
                    if run:
                        run.status = RunStatus.failed
                        run.error = str(e)
                        session.add(run)
                        session.commit()
        return GenerateAndBacktestResponse(run_id=run_id, program_code=code)
    except HTTPException:
        raise
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
    def _inline_finish_if_stuck(program_code: str, symbol: str, period: str, timeframe: str) -> None:
        time.sleep(3.0)
        with Session(engine) as session:
            run = session.get(Run, body.run_id)
            if not run or run.status != RunStatus.pending:
                return
            run.status = RunStatus.running
            run.error = None
            session.add(run)
            session.commit()
        try:
            output_dir = Path(settings.storage_dir) / "artifacts" / f"run_{body.run_id}"
            run_inline_backtest(
                symbol=symbol,
                period=period,
                timeframe=timeframe,
                program_code=program_code,
                output_dir=output_dir,
            )
            with Session(engine) as session:
                run = session.get(Run, body.run_id)
                if run:
                    run.status = RunStatus.completed
                    run.error = None
                    session.add(run)
                    session.commit()
        except Exception as ee:
            with Session(engine) as session:
                run = session.get(Run, body.run_id)
                if run:
                    run.status = RunStatus.failed
                    run.error = str(ee)
                    session.add(run)
                    session.commit()

    try:
        q = get_queue()
        q.enqueue("lpft_worker.jobs.run_backtest_job", body.run_id, job_id=f"run_{body.run_id}")
        with Session(engine) as session:
            run = session.get(Run, body.run_id)
            symbol = run.symbol or "AAPL" if run else "AAPL"
            period = run.period or "1y" if run else "1y"
            timeframe = run.timeframe or "1d" if run else "1d"
            code = run.program_code or "" if run else ""
        threading.Thread(target=_inline_finish_if_stuck, args=(code, symbol, period, timeframe), daemon=True).start()
    except Exception:
        # Fallback inline
        with Session(engine) as session:
            run = session.get(Run, body.run_id)
            if not run:
                raise HTTPException(status_code=404, detail="Run not found")
            run.status = RunStatus.running
            run.error = None
            session.add(run)
            session.commit()
            symbol = run.symbol or "AAPL"
            period = run.period or "1y"
            timeframe = run.timeframe or "1d"
            code = run.program_code or ""
        try:
            output_dir = Path(settings.storage_dir) / "artifacts" / f"run_{body.run_id}"
            run_inline_backtest(
                symbol=symbol,
                period=period,
                timeframe=timeframe,
                program_code=code,
                output_dir=output_dir,
            )
            with Session(engine) as session:
                run = session.get(Run, body.run_id)
                if run:
                    run.status = RunStatus.completed
                    run.error = None
                    session.add(run)
                    session.commit()
        except Exception as ee:
            with Session(engine) as session:
                run = session.get(Run, body.run_id)
                if run:
                    run.status = RunStatus.failed
                    run.error = str(ee)
                    session.add(run)
                    session.commit()
            raise HTTPException(status_code=500, detail=str(ee)) from ee
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
def fetch_dataset(symbol: str = "AAPL", period: str = "1y", interval: str = "1d"):
    df = fetch_ohlcv_yahoo(symbol, period=period, interval=interval)
    if df.empty:
        raise HTTPException(status_code=400, detail="No data for symbol/period")
    datasets_dir = Path(settings.storage_dir) / "datasets"
    datasets_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{symbol}_{period}_{interval}.csv"
    path = datasets_dir / filename
    df.to_csv(path)
    return DatasetFetchResponse(symbol=symbol, period=period, interval=interval, rows=len(df), path=str(path))
