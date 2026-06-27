from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel, create_engine

from lpft_worker.config import settings


def _create_db_engine(url: str):
    if url.startswith("sqlite"):
        return create_engine(
            url,
            echo=False,
            connect_args={"check_same_thread": False},
        )
    return create_engine(url, echo=False, pool_pre_ping=True)


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Run(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    strategy_id: Optional[int] = None
    status: RunStatus = RunStatus.pending
    run_type: str = "backtest"
    program_code: Optional[str] = None
    period: Optional[str] = None
    timeframe: Optional[str] = None
    symbol: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    error: Optional[str] = None


engine = _create_db_engine(str(settings.database_url))
