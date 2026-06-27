from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_env_file = Path(__file__).resolve().parents[1] / ".env.local"

# Default: stesso cluster usato da `infra/docker-compose.yml` (servizio postgres, DB `lpft`).
# AFX (Prisma) resta su un altro database nello stesso host (es. `afx_dev`) — nessuna tabella condivisa.
_DEFAULT_POSTGRES_URL = "postgresql+psycopg://lpft:lpft@127.0.0.1:5432/lpft"


def _default_database_url() -> str:
    return _DEFAULT_POSTGRES_URL


class Settings(BaseSettings):
    # project root is one level above services/
    storage_dir: Path = Path(__file__).resolve().parents[3] / "storage"
    # LPFT_DATABASE_URL — PostgreSQL consigliato (database `lpft` separato da quello Prisma AFX).
    database_url: str = _default_database_url()
    redis_url: str = "redis://localhost:6379/0"
    anthropic_api_key: str = ""
    llm_model: str = "claude-sonnet-4-20250514"
    # Generazione spec non-streaming: forza tool `submit_strategy_spec` + JSON Schema Pydantic.
    strategy_spec_tool_use: bool = True
    # Secondo passaggio LLM su data.notes se più corta della soglia (0 = disabilitato).
    notes_enrich_min_chars: int = 120
    notes_enrich_enabled: bool = True
    frontend_base_url: str = "http://localhost:3000"
    # --- Ponte event-driven verso AFX (Redis) ---
    afx_intents_enabled: bool = False
    afx_intents_channel: str = "afx:intents:new"

    @field_validator("database_url", mode="after")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        """
        PostgreSQL: invariato.

        SQLite (solo legacy / test): sqlite:///./lpft.db dipendeva dalla cwd di uvicorn.
        Forziamo path assoluto sotto services/api/. sqlite:////… resta assoluto Unix.
        """
        if not v.startswith("sqlite:///"):
            return v
        if v.startswith("sqlite:////"):
            return v
        path_part = v[10:].split("?", 1)[0]
        p = Path(path_part)
        if p.is_absolute():
            return v
        api_dir = Path(__file__).resolve().parents[1]
        abs_p = (api_dir / path_part).resolve()
        rest = v[10 + len(path_part) :]
        return f"sqlite:///{abs_p}{rest}"

    model_config = SettingsConfigDict(
        env_prefix="LPFT_",
        env_file=_env_file,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
