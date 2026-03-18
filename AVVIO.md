# LPFT – Avvio da zero

Segui i passi **in ordine**, in terminali separati.

---

## Passo 0: Chiudi tutto (opzionale)

Se qualcosa era già avviato, puoi liberare le porte:

```bash
# Termina eventuali processi su porta 8000 (API) e 3000 (frontend)
lsof -i :8000 -t | xargs kill -9 2>/dev/null
lsof -i :3000 -t | xargs kill -9 2>/dev/null
```

---

## Passo 1: Redis (per i backtest)

Solo se hai **Docker** avviato:

```bash
cd /Users/marcolaporta/Documents/infra
docker compose up -d redis
```

Se non usi Docker, salta questo passo. L’API partirà uguale; “Esegui backtest” darà errore finché Redis non è attivo.

---

## Passo 2: API (porta 8000)

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

## Passo 3: Worker (solo se hai avviato Redis)

**Terminale 2** (apri un secondo terminale):

```bash
cd /Users/marcolaporta/Documents/services/worker
source .venv/bin/activate
LPFT_REDIS_URL="redis://localhost:6379/0" python -m lpft_worker.worker
```

Lascia aperto. Serve per eseguire i backtest in coda.

---

## Passo 4: Frontend (porta 3000)

**Terminale 3** (terzo terminale):

```bash
cd /Users/marcolaporta/Documents/apps/web
npm install
NEXT_PUBLIC_LPFT_API_BASE="http://localhost:8000" npm run dev
```

Quando vedi **"Ready"**, nel browser apri:

**http://127.0.0.1:3000**

(Scrivi **:3000** alla fine dell’indirizzo.)

> **Attenzione:** L’**interfaccia utente** (chat, backtest, grafico) è sulla **porta 3000**.  
> La porta **8000** apre i **documenti API (Swagger)**: non è l’app che usi per generare strategie.  
> Per far funzionare «Genera strategia» devono essere avviati **API (passo 2)** e, per il backtest, **Redis + Worker (passi 1 e 3)**.

---

## Riepilogo

| Cosa    | Porta | URL                    |
|---------|--------|-------------------------|
| API     | 8000   | http://localhost:8000   |
| API docs| 8000   | http://localhost:8000/docs |
| Frontend| 3000   | http://127.0.0.1:3000   |

---

## Se qualcosa non parte

- **API: "Address already in use"** → qualcosa usa la 8000. Esegui il Passo 0 e riprova.
- **Frontend non si apre** → usa **Chrome** e l’indirizzo esatto **http://127.0.0.1:3000**.
- **"Unexpected end of JSON"** → l’API non è raggiungibile. Verifica che il Passo 2 sia in esecuzione e che http://localhost:8000/docs si apra.
