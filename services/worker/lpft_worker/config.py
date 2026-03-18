from pathlib import Path
from pydantic_settings import BaseSettings


def _default_storage_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "storage"


class Settings(BaseSettings):
    storage_dir: Path = _default_storage_dir()
    database_url: str = "sqlite:///./lpft.db"
    redis_url: str = "redis://localhost:6379/0"

    class Config:
        env_prefix = "LPFT_"


settings = Settings()
