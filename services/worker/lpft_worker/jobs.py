from __future__ import annotations

from pathlib import Path

from sqlmodel import Session, select

from lpft_worker.config import settings
from lpft_worker.db import Run, RunStatus, engine
from lpft_shared.engine import extract_program_metadata, run_backtest_from_market_data, write_validation_artifact
from lpft_shared.market_data import DataQualityError, load_market_data_bundle


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
        metadata = extract_program_metadata(program)
        symbols = metadata.symbols or [run.symbol or "AAPL"]
        output_dir = Path(settings.storage_dir) / "artifacts" / f"run_{run_id}"
        try:
            market_data = load_market_data_bundle(
                symbols,
                period=period,
                timeframe=run.timeframe or metadata.timeframe or "1d",
                asset_class=metadata.asset_class,
                provider_preference=metadata.provider_preference,
                quality_policy=metadata.quality_policy,
                freshness_requirement=metadata.freshness_requirement,
                coverage_requirement=metadata.coverage_requirement,
                corporate_actions_required=metadata.corporate_actions_required,
                market=metadata.market,
                storage_dir=Path(settings.storage_dir),
            )
        except DataQualityError as exc:
            write_validation_artifact(
                output_dir,
                {
                    "status": "rejected",
                    "engine_version": metadata.engine_version,
                    "artifact_type": metadata.artifact_type,
                    "strategy_kind": metadata.strategy_kind,
                    "position_mode": metadata.position_mode,
                    "symbols_requested": symbols,
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
                    "data_error": exc.report,
                },
                program,
            )
            run.status = RunStatus.failed
            run.error = exc.report.get("summary", "Market data quality rejected")
            session.add(run)
            session.commit()
            return
        run_backtest_from_market_data(market_data, program, output_dir)
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
