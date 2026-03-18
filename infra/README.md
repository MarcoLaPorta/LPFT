# Infra LPFT (Docker)

Avvio **tutto lo stack** con Docker (PostgreSQL, Redis, API, Worker):

```bash
cd /Users/marcolaporta/Documents/infra
# Opzionale: passa la API key Anthropic (per generazione strategie/programmi)
export LPFT_ANTHROPIC_API_KEY="sk-ant-..."
docker compose up -d
```

- **API:** http://localhost:8000 (docs: http://localhost:8000/docs)
- **PostgreSQL:** localhost:5432 (user/pass: lpft/lpft, db: lpft)
- **Redis:** localhost:6379

Il frontend (Next.js) va avviato a parte in locale:

```bash
cd /Users/marcolaporta/Documents/apps/web
NEXT_PUBLIC_LPFT_API_BASE="http://localhost:8000" npm run dev
```

Poi apri **http://localhost:3000** nel browser.

---

## Se l’API non è raggiungibile (senza Docker)

Avvia **solo Redis** (con Docker, solo i servizi infra):

```bash
cd /Users/marcolaporta/Documents/infra
docker compose up -d redis
```

Poi avvia l’**API in locale** in un altro terminale:

```bash
cd /Users/marcolaporta/Documents/services/api
source .venv/bin/activate
pip install -e .   # solo la prima volta
./run-api.sh
```

Oppure senza script:

```bash
cd /Users/marcolaporta/Documents/services/api
source .venv/bin/activate
LPFT_REDIS_URL="redis://localhost:6379/0" uvicorn lpft_api.main:app --reload --host 0.0.0.0 --port 8000
```

Controlla che risponda: **http://localhost:8000** e **http://localhost:8000/docs**.
