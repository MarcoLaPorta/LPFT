from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, select

from lpft_worker.backtest import run_backtest
from lpft_worker.config import settings
from lpft_worker.data import dataset_path, load_ohlcv_csv, slice_ohlcv_by_period
from lpft_worker.db import Run, RunStatus, engine

PERIOD_MAP = {"1m": "1mo", "3m": "3mo", "6m": "6mo", "1y": "1y", "2y": "2y", "5y": "5y"}


def _ensure_ohlcv(run: Run) -> tuple[Path | None, str | None]:
    symbol = run.symbol or "AAPL"
    period = run.period or "1y"
    interval = run.timeframe or "1d"
    period_norm = PERIOD_MAP.get(period, period)
    candidates = [
        dataset_path(f"{symbol}_{period_norm}_{interval}.csv"),
        dataset_path(f"{symbol}_{period}_{interval}.csv"),
    ]
    for p in candidates:
        if p.is_file():
            return p, None
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period_norm if period_norm in ("1mo", "3mo", "6mo", "1y", "2y", "5y") else "1y", interval=interval)
        if df.empty:
            return None, "No data"
        df = df.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
        df = df[["open", "high", "low", "close", "volume"]].dropna()
        df.index.name = "datetime"
        p = dataset_path(f"{symbol}_{period_norm}_{interval}.csv")
        p.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(p)
        return p, None
    except Exception as e:
        return None, str(e)


def backtest_job(run_id: int, period: str | None = None) -> None:
    """Strategy-based backtest (delegate to program_backtest_job with program from DB)."""
    program_backtest_job(run_id, None, period)


def paper_job(run_id: int) -> None:
    """Paper trading job (stub)."""
    pass


def run_backtest_job(run_id: int) -> None:
    """Entry point for RQ: run backtest for run_id (loads program from DB)."""
    program_backtest_job(run_id, None, None)


def program_backtest_job(run_id: int, program: str | None = None, period: str | None = None) -> None:
    session = Session(engine)
    try:
        run = session.get(Run, run_id)
        if not run:
            return
        run.status = RunStatus.running
        session.add(run)
        session.commit()
        program = program or run.program_code
        if not program:
            run.status = RunStatus.failed
            run.error = "No program_code"
            session.add(run)
            session.commit()
            return
        period = period or run.period or "1y"
        ds_path, err = _ensure_ohlcv(run)
        if err or not ds_path:
            run.status = RunStatus.failed
            run.error = err or "No OHLCV"
            session.add(run)
            session.commit()
            return
        ohlcv = load_ohlcv_csv(ds_path)
        ohlcv = slice_ohlcv_by_period(ohlcv, PERIOD_MAP.get(period, period))
        if ohlcv.empty:
            run.status = RunStatus.failed
            run.error = "OHLCV empty after slice"
            session.add(run)
            session.commit()
            return
        output_dir = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}"
        run_backtest(ohlcv, program, output_dir)
        run.status = RunStatus.completed
        run.error = None
        session.add(run)
        session.commit()
    except Exception as e:
        run = session.get(Run, run_id)
        if run:
            run.status = RunStatus.failed
            run.error = str(e)
            session.add(run)
            session.commit()
        raise
    finally:
        session.close()
