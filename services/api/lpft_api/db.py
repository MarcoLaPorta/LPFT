from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel, create_engine

from lpft_api.config import settings


def _create_db_engine(url: str):
    """Pool e ping solo per Postgres; SQLite legacy resta single-thread."""
    if url.startswith("sqlite"):
        return create_engine(
            url,
            echo=False,
            connect_args={"check_same_thread": False},
        )
    return create_engine(
        url,
        echo=False,
        pool_pre_ping=True,
    )


class RunType(str, Enum):
    backtest = "backtest"
    live = "live"


class RunStatus(str, Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class Strategy(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    spec: dict[str, Any] = Field(sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Run(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    strategy_id: Optional[int] = Field(default=None, foreign_key="strategy.id")
    status: RunStatus = RunStatus.pending
    run_type: RunType = RunType.backtest
    program_code: Optional[str] = None
    period: Optional[str] = None
    timeframe: Optional[str] = None
    symbol: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None
    error: Optional[str] = None


class OrderSide(str, Enum):
    buy = "buy"
    sell = "sell"


class OrderType(str, Enum):
    market = "market"
    limit = "limit"


class OrderStatus(str, Enum):
    pending = "pending"
    filled = "filled"
    cancelled = "cancelled"


class PaperOrder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="run.id")
    side: OrderSide
    order_type: OrderType = OrderType.market
    status: OrderStatus = OrderStatus.pending
    symbol: str
    quantity: float
    price: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PaperTrade(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="run.id")
    side: OrderSide
    symbol: str
    quantity: float
    price: float
    executed_at: datetime = Field(default_factory=datetime.utcnow)


class PaperPosition(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="run.id")
    symbol: str
    quantity: float
    avg_price: float


database_url = str(settings.database_url)
engine = _create_db_engine(database_url)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
