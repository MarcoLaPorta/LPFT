#!/usr/bin/env bash
# Avvia API (8000) + frontend Next (3000) in un solo terminale.
# Uso: dalla root del repo → ./scripts/start-lpft.sh
# Ctrl+C ferma entrambi.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT/services/api"
WEB_DIR="$ROOT/apps/web"
INFRA_DIR="$ROOT/infra"

echo "== LPFT: avvio stack locale =="

free_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -z "${pids:-}" ]; then
    return 0
  fi
  echo "Libero porta $port (PID: $pids)..."
  kill $pids 2>/dev/null || true
  sleep 1
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "${pids:-}" ]; then
    echo "  (secondo tentativo kill -9 su $port)"
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
  if lsof -ti ":$port" &>/dev/null; then
    echo "ERRORE: la porta $port è ancora occupata. Esegui manualmente:"
    echo "  lsof -ti :$port | xargs kill -9"
    exit 1
  fi
}

for port in 8000 3000; do
  free_port "$port"
done

if [ ! -f "$API_DIR/.env.local" ]; then
  if [ -f "$API_DIR/env.local.template" ]; then
    cp "$API_DIR/env.local.template" "$API_DIR/.env.local"
    echo "Creato services/api/.env.local da template — compila LPFT_ANTHROPIC_API_KEY e LPFT_DATABASE_URL se necessario."
  fi
fi

if [ -f "$INFRA_DIR/docker-compose.yml" ] && command -v docker &>/dev/null; then
  echo "Avvio Postgres + Redis (docker compose)..."
  (cd "$INFRA_DIR" && docker compose up -d postgres redis) || echo "(Infra opzionale: salta se Docker non disponibile)"
fi

if [ ! -d "$API_DIR/.venv" ]; then
  echo "ERRORE: crea il venv API:"
  echo "  cd $API_DIR && python3 -m venv .venv && source .venv/bin/activate && pip install -e ."
  exit 1
fi

if [ ! -f "$WEB_DIR/.env.local" ]; then
  if [ -f "$WEB_DIR/env.local.template" ]; then
    cp "$WEB_DIR/env.local.template" "$WEB_DIR/.env.local"
    echo "Creato apps/web/.env.local da template — imposta DATABASE_URL (Prisma AFX) e, se usi POST /api/chat, ANTHROPIC_API_KEY."
  fi
fi

if [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "npm install in apps/web..."
  (cd "$WEB_DIR" && npm install)
fi

cleanup() {
  echo ""
  echo "Arresto API e web..."
  kill "${API_PID:-0}" "${WEB_PID:-0}" 2>/dev/null || true
}
# Solo INT/TERM: se l'API cade (es. DB assente), NON uscire con set -e su `wait` uccidendo Next.
trap cleanup INT TERM

echo "Avvio API su :8000..."
(
  cd "$API_DIR"
  # shellcheck source=/dev/null
  source .venv/bin/activate
  export LPFT_DATABASE_URL="${LPFT_DATABASE_URL:-postgresql+psycopg://lpft:lpft@127.0.0.1:5432/lpft}"
  export LPFT_REDIS_URL="${LPFT_REDIS_URL:-redis://localhost:6379/0}"
  exec uvicorn lpft_api.main:app --reload --host 0.0.0.0 --port 8000
) &
API_PID=$!

sleep 2

echo "Avvio Next su :3000..."
(
  cd "$WEB_DIR"
  export NEXT_PUBLIC_LPFT_API_BASE="${NEXT_PUBLIC_LPFT_API_BASE:-http://127.0.0.1:8000}"
  exec npm run dev
) &
WEB_PID=$!

echo ""
echo "Attendo che Next risponda su http://127.0.0.1:3000 ..."
ready=0
for _ in $(seq 1 45); do
  if curl -sf --connect-timeout 1 "http://127.0.0.1:3000/" >/dev/null 2>&1; then
    ready=1
    echo "  OK: frontend in ascolto."
    break
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "ERRORE: il processo Next (npm) è terminato. Apri un terminale e lancia:"
    echo "  cd $WEB_DIR && npm run dev"
    echo "e leggi l'errore (porta occupata, dipendenze, ecc.)."
    ready=0
    break
  fi
  sleep 1
done
if [ "$ready" -eq 0 ] && kill -0 "$WEB_PID" 2>/dev/null; then
  echo "AVVISO: dopo 45s Next non risponde ancora a curl; controlla il log nel terminale (compilazione lenta?)."
fi

echo ""
echo "  API:  http://127.0.0.1:8000/docs"
echo "  App:  http://127.0.0.1:3000"
echo ""
echo "Ctrl+C per fermare tutto."

# Attendi i due processi: l'uscita di uno non deve terminare l'altro (né far uscire lo script con set -e).
set +e
wait "$API_PID"
api_st=$?
wait "$WEB_PID"
web_st=$?
set -e
if [ "${api_st:-0}" -ne 0 ]; then
  echo "(API terminata con codice $api_st — controlla Postgres e $API_DIR)"
fi
if [ "${web_st:-0}" -ne 0 ]; then
  echo "(Next terminato con codice $web_st — controlla la porta 3000 e apps/web)"
fi
