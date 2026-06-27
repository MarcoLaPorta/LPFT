#!/usr/bin/env bash
# Avvia l'API LPFT in locale (porta 8000).
# Richiede: Redis in esecuzione (localhost:6379) per la coda backtest.
# Se usi solo strategie/run/list senza lanciare job, funziona anche senza Redis.

cd "$(dirname "$0")"
if [ -d ".venv" ]; then
  source .venv/bin/activate
else
  echo "Crea prima il venv: python3 -m venv .venv && source .venv/bin/activate && pip install -e ."
  exit 1
fi

export LPFT_DATABASE_URL="${LPFT_DATABASE_URL:-postgresql+psycopg://lpft:lpft@127.0.0.1:5432/lpft}"
export LPFT_REDIS_URL="${LPFT_REDIS_URL:-redis://localhost:6379/0}"

echo "API su http://localhost:8000 (docs: http://localhost:8000/docs)"
exec uvicorn lpft_api.main:app --reload --host 0.0.0.0 --port 8000
