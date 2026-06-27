from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Allineato a lpft_api.config: stesso Postgres `lpft` sul cluster locale / Docker.
_DEFAULT_POSTGRES_URL = "postgresql+psycopg://lpft:lpft@127.0.0.1:5432/lpft"

_api_env_local = Path(__file__).resolve().parents[2] / "api" / ".env.local"


def _default_storage_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "storage"


def _default_database_url() -> str:
    return _DEFAULT_POSTGRES_URL


class Settings(BaseSettings):
    storage_dir: Path = _default_storage_dir()
    database_url: str = _default_database_url()
    redis_url: str = "redis://localhost:6379/0"

    model_config = SettingsConfigDict(
        env_prefix="LPFT_",
        env_file=str(_api_env_local),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
