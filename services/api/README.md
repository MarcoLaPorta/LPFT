# LPFT API

Backend del **medesimo exchange agentico**: generazione intent/strategie, backtest, dati di mercato (Yahoo / Stooq). La persistenza exchange (wallet, vault, `ExecutionLog`) è in **`apps/web`** (Prisma, `apps/web/prisma`) e la UI la legge sulla stessa origine (:3000) — vedi [`docs/UNIFIED_EXCHANGE.md`](../../docs/UNIFIED_EXCHANGE.md).

## Variabili d’ambiente

```bash
cd services/api
cp env.local.template .env.local
# Modifica .env.local: almeno LPFT_ANTHROPIC_API_KEY e LPFT_DATABASE_URL.
```

Il file `.env.local` è ignorato da git (non committare segreti).

### Database (PostgreSQL)

LPFT persiste strategie, run e metadati su **PostgreSQL** (`LPFT_DATABASE_URL`), non più su SQLite di default.

- **Consigliato:** database dedicato `lpft` sullo stesso server usato da **AFX (Prisma)** per evitare conflitti di schema (AFX tipicamente su `afx_dev` o altro nome).
- **Docker:** `cd ../../infra && docker compose up -d postgres` (vedi `docker-compose.yml`: user `lpft`, password `lpft`, DB `lpft`).
- **Driver:** URL con prefisso `postgresql+psycopg://` (psycopg v3, già in `pyproject.toml`).
- **Legacy:** `sqlite:///...` resta accettato se impostato esplicitamente in `LPFT_DATABASE_URL` (path relativo normalizzato sotto `services/api/`).

## Avvio rapido (sviluppo)

```bash
# dalla root del repo, con venv attivo e dipendenze installate
cd services/api
uvicorn lpft_api.main:app --reload --host 0.0.0.0 --port 8000
```

(Usa il comando che già usi nel progetto se diverso.)
