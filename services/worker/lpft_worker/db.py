from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel, create_engine

from lpft_worker.config import settings


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


engine = create_engine(str(settings.database_url), echo=False)
