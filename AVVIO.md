# LPFT – Avvio da zero

> **Prodotto unico:** l’Agentic Finance Exchange è **un’unica app Next** in `apps/web` (porta **3000**): home LPFT, **`/exchange`** (audit Prisma). Prisma e migrazioni sono in **`apps/web/prisma`**. Leggi [`docs/UNIFIED_EXCHANGE.md`](docs/UNIFIED_EXCHANGE.md).

## Un solo comando (API + web)

Dalla **root del repo** (cartella che contiene `scripts/` e `services/`):

```bash
./scripts/start-lpft.sh
```

Oppure, dalla stessa cartella: `npm start` (usa lo stesso script).

Libera le porte **8000** e **3000**, crea `.env.local` dal template se manca, prova ad avviare **Postgres** e **Redis** con Docker, poi avvia **uvicorn** e **Next**. **Ctrl+C** ferma tutto.

---

Segui i passi sotto se preferisci **terminali separati** o worker Redis dedicato.

---

## Passo 0: Chiudi tutto (opzionale)

Se qualcosa era già avviato, puoi liberare le porte:

```bash
# Termina eventuali processi su porta 8000 (API) e 3000 (frontend)
lsof -i :8000 -t | xargs kill -9 2>/dev/null
lsof -i :3000 -t | xargs kill -9 2>/dev/null
```

---

## Passo 1: PostgreSQL (database LPFT)

L’API LPFT usa **PostgreSQL** (variabile `LPFT_DATABASE_URL`), di default il database **`lpft`** sullo stesso host usato da Docker (`lpft` / `lpft`).

Con Docker (consigliato, stesso compose di Redis):

```bash
cd /Users/marcolaporta/Documents/infra
docker compose up -d postgres
```

**AFX (Prisma)** usa un altro database nello stesso server (es. `afx_dev`): nessun conflitto di tabelle. Imposta **`DATABASE_URL`** in **`apps/web/.env.local`** (vedi `apps/web/env.local.template`); per applicare lo schema: `cd apps/web && npx prisma migrate deploy`.

Se non hai Postgres in ascolto, l’API fallirà all’avvio finché non avvii il servizio o non imposti un URL valido in `services/api/.env.local`.

---

## Passo 2: Redis (per i backtest in coda)

Solo se hai **Docker** avviato:

```bash
cd /Users/marcolaporta/Documents/infra
docker compose up -d redis
```

Se non usi Docker, salta questo passo. L’API partirà uguale; “Esegui backtest” darà errore finché Redis non è attivo.

---

## Passo 3: API (porta 8000)

**Terminale 1:**

```bash
cd /Users/marcolaporta/Documents/services/api
source .venv/bin/activate
# Opzionale ma necessario per «Genera strategia»: chiave API Anthropic
export LPFT_ANTHROPIC_API_KEY="la-tua-chiave"
uvicorn lpft_api.main:app --reload --host 0.0.0.0 --port 8000
```

Lascia questo terminale aperto. Controlla che funzioni: apri **http://localhost:8000/docs** nel browser.

> **Genera strategia** usa l’LLM Anthropic (Claude). Senza `LPFT_ANTHROPIC_API_KEY` l’API risponderà 503 con un messaggio esplicito.

---

## Passo 4: Worker (opzionale ma consigliato con Redis)

**Terminale 2** (apri un secondo terminale):

```bash
cd /Users/marcolaporta/Documents/services/worker
source .venv/bin/activate
LPFT_REDIS_URL="redis://localhost:6379/0" python -m lpft_worker.worker
```

Lascia aperto. Con **Redis + worker** attivi, i backtest vanno in **coda RQ**.  
Se Redis c’è ma il **worker non è avviato**, l’API (versione recente) esegue il backtest **inline** nello stesso processo dell’API, così non resti bloccato su «In coda per il backtest» all’infinito.

---

## Passo 4b: Consumer intent LPFT → Prisma (opzionale)

Se in `services/api/.env.local` imposti **`LPFT_AFX_INTENTS_ENABLED=true`**, l’API pubblica gli intent su Redis. Per scriverli nel database AFX (`ExecutionLog`) avvia in un terminale separato:

```bash
cd /Users/marcolaporta/Documents/apps/web
# Usa .env.local con DATABASE_URL + LPFT_REDIS_URL (stesso Redis dell’API)
npm run worker:intents
```

Il channel Redis deve coincidere con **`LPFT_AFX_INTENTS_CHANNEL`** lato API (default `afx:intents:new` = **`AFX_INTENTS_CHANNEL`** in `apps/web/env.local.template`).

---

## Passo 5: Frontend (porta 3000)

**Terminale 3** (terzo terminale):

```bash
cd /Users/marcolaporta/Documents/apps/web
cp env.local.template .env.local   # una tantum: poi compila DATABASE_URL e ANTHROPIC_API_KEY
npm install
NEXT_PUBLIC_LPFT_API_BASE="http://localhost:8000" npm run dev
```

Quando vedi **"Ready"**, nel browser apri:

**http://127.0.0.1:3000**

(Scrivi **:3000** alla fine dell’indirizzo.)

> **Attenzione:** L’**interfaccia utente** (chat LPFT, backtest, grafico, **exchange**) è tutta sulla **porta 3000** (nessuna :3001).  
> La porta **8000** apre i **documenti API (Swagger)**: non è l’app che usi per generare strategie.  
> Per far funzionare «Genera strategia» servono **Postgres (passo 1)**, **API (passo 3)** e, per il backtest in coda, **Redis + worker RQ (passo 4)**. Per **`/exchange`** e integrazioni AFX serve **`DATABASE_URL`**; per **`POST /api/chat`** (opzionale) **`ANTHROPIC_API_KEY`** in `apps/web/.env.local`. Per **ExecutionLog** da intent Redis (`LPFT_AFX_INTENTS_ENABLED`): **passo 4b** (`npm run worker:intents`).

> **Nuova strategia:** indica un **ticker o ETF** nel messaggio (es. `AAPL`, `SPY`); altrimenti l’assistente chiede prima quale strumento usare (niente default implicito).

---

## Riepilogo

| Cosa    | Porta | URL                    |
|---------|--------|-------------------------|
| API     | 8000   | http://localhost:8000   |
| API docs| 8000   | http://localhost:8000/docs |
| Frontend| 3000   | http://127.0.0.1:3000   |

---

## Se qualcosa non parte

- **`ERR_CONNECTION_REFUSED` su tutte le pagine** → **nessun server sulla porta 3000** (Next non avviato o terminato subito). Dalla root del repo: `./scripts/start-lpft.sh` oppure `npm start`; in alternativa `cd apps/web && npm run dev`. Porta occupata: `lsof -ti :3000 | xargs kill -9` poi `npm run dev:restart` in `apps/web`.
- **API: "Address already in use"** → qualcosa usa la 8000. Esegui il Passo 0 e riprova.
- **Frontend non si apre** → usa **Chrome** e l’indirizzo esatto **http://127.0.0.1:3000**.
- **"Unexpected end of JSON"** → l’API non è raggiungibile. Verifica che il Passo 3 sia in esecuzione e che http://localhost:8000/docs si apra.
- **"Internal Server Error" sulla pagina Next** → ferma `next dev`, nella cartella `apps/web` esegui `rm -rf .next` e riavvia `npm run dev` (cache di build corrotta o processo vecchio sulla porta 3000).
