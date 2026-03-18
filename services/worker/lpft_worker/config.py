from pathlib import Path
from pydantic_settings import BaseSettings


def _default_storage_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "storage"


def _default_database_url() -> str:
    db_path = Path(__file__).resolve().parents[2] / "api" / "lpft.db"
    return f"sqlite:///{db_path}"


class Settings(BaseSettings):
    storage_dir: Path = _default_storage_dir()
    database_url: str = _default_database_url()
    redis_url: str = "redis://localhost:6379/0"

    class Config:
        env_prefix = "LPFT_"


settings = Settings()
