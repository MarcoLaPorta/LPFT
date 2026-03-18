from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # project root is one level above services/
    storage_dir: Path = Path(__file__).resolve().parents[3] / "storage"
    # Use LPFT_DATABASE_URL in prod (e.g. postgresql+psycopg://lpft:lpft@localhost:5432/lpft)
    database_url: str = "sqlite:///./lpft.db"
    redis_url: str = "redis://localhost:6379/0"
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-4-20250514"

    class Config:
        env_prefix = "LPFT_"

settings = Settings()
