from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_env_file = Path(__file__).resolve().parents[1] / ".env.local"


def _default_database_url() -> str:
    db_path = Path(__file__).resolve().parents[1] / "lpft.db"
    return f"sqlite:///{db_path}"


class Settings(BaseSettings):
    # project root is one level above services/
    storage_dir: Path = Path(__file__).resolve().parents[3] / "storage"
    # Use LPFT_DATABASE_URL in prod (e.g. postgresql+psycopg://lpft:lpft@localhost:5432/lpft)
    database_url: str = _default_database_url()
    redis_url: str = "redis://localhost:6379/0"
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-4-20250514"
    # Optional: US equity bars via Alpaca (read also by lpft_shared.market_data via same env names).
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""

    model_config = SettingsConfigDict(
        env_prefix="LPFT_",
        env_file=_env_file,
        env_file_encoding="utf-8",
        extra="ignore",
    )

settings = Settings()
