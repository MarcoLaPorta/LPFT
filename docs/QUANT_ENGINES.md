# LPFT/AFX Quant Engines (Phase A)

Questo documento chiarisce quando usare il motore quant TypeScript event-driven già integrato nella chat AFX e quando usare il motore Python `lpft_shared` esposto via API su `:8000`.

## Stato attuale

- I due engine **coesistono** e servono percorsi diversi.
- Non c'è merge del codice tra engine in questa fase.
- La scelta avviene in base al contesto operativo (UX chat vs API service).

## Engine 1 — TypeScript Event-Driven (chat path)

### Quando usarlo

Usare il motore TS quando il flusso parte dalla chat fiduciaria nella web app e serve una risposta rapida, interattiva, con output immediatamente renderizzabile in UI.

Casi tipici:

- build/iterazione strategia da assistente (`buildQuantitativeStrategy`);
- backtest veloce orchestrato da tool chat;
- generazione output per pannelli UI (equity series, metriche, trade list);
- guardrail fiduciari direttamente nel flusso assistant.

### Entry points principali

- `apps/web/lib/afx-chat-tools.ts`
  - Tool chat (`buildQuantitativeStrategy`, `runStrategyBacktest`, `proposeExecution`)
- `apps/web/services/quant/event-driven-engine.ts`
  - Core engine event-driven
- `apps/web/services/quant/backtest.ts`
  - Orchestrazione backtest + metriche
- `apps/web/services/market_data.ts`
  - Accesso dati OHLCV (con cache Prisma)
- `apps/web/services/market_data/data_fetcher.ts`
  - Router ibrido Alpaca/Yahoo + persistenza `MarketDataBar`
- `apps/web/services/market_data/router.ts`
  - `HIGH_FREQUENCY_SCALPING` / equity USA → Alpaca; wallet/macro → Yahoo
- `apps/web/services/market_data/tick-replay-engine.ts`
  - Replay tick Alpaca verso `HFTExecutionEngine` (env `AFX_HFT_REPLAY=alpaca`)

### Caratteristiche operative

- Integrato nativamente con Vercel AI SDK/tooling della chat.
- Ciclo rapido "prompt -> tool -> risposta stream".
- Latency orientata UX e explainability lato frontend.
- Dati allineati a esigenze di analisi/report nella UI AFX.

## Tier 1 Phase 4 — Claude orchestration & prompt caching

- `lib/afx-fiduciary-prompt.ts` — `afx-fiduciary-v3-tier1`: istruzioni DSR, CPCV, CVaR, PiT, regime, Kelly
- `lib/afx-strategy-schema-guide.ts` — schema Zod cacheable nel system prompt
- `lib/afx-anthropic-cache.ts` — `cacheControl: ephemeral` su system + tool `buildQuantitativeStrategy`
- `app/api/chat/route.ts` — system message strutturato; header `x-afx-prompt-cache`

Env: `AFX_PROMPT_CACHE=false` per disabilitare; `AFX_LOG_PROMPT_CACHE=true` per debug token cache.

## Tier 1 Phase 3 — Bias guard & regime (TypeScript event-driven)

| Modulo | Ruolo |
|--------|--------|
| `services/quant/pit-proxy.ts` | Point-in-Time: `sliceMatrixAsOf` nasconde barre future ai segnali |
| `services/quant/regime-analysis.ts` | `analyzeMarketRegimes` su Covid 2020, bear 2022, rate shock 2023 |
| `services/quant/kelly-sizing.ts` | Fractional Kelly (default ¼-Kelly) su pesi target |
| `event-driven-engine.ts` | PiT su Fase C + Kelly cap + `regimeAnalysis` in output |

Schema Zod: `riskManagement.fractionalKelly`, `enableKellyCap`. UI: sezione **Regimi stress** in `StrategyReportView`.

## Tier 1 Phase 2 — Validazione quant Python (CPCV, DSR, FFD, MC, CVaR)

Statistiche pesanti **solo in Python** (`lpft_shared/tier1/`), esposte via API senza bloccare il loop Node.

| Endpoint | Descrizione |
|----------|-------------|
| `POST /quant/tier1/validate` | Pipeline completa su equity/returns |
| `POST /quant/tier1/monte-carlo` | Solo simulazione MC (default 10k path) |

Bridge Next.js:

- `apps/web/lib/lpft-tier1.ts` — client server-side verso `:8000`
- `apps/web/app/api/quant/tier1-validate/route.ts` — proxy opzionale
- `buildQuantitativeStrategy` (daily) allega `tier1Validation` se l'API Python è raggiungibile

## Engine 2 — Python `lpft_shared` (API `:8000`)

### Quando usarlo

Usare il path Python per workload di servizio e integrazione backend, dove conta stabilità API e riuso nel perimetro `services/api` + `services/shared`.

Casi tipici:

- endpoint API dedicati a strategia/esecuzione;
- pipeline worker e flussi non interattivi;
- logica condivisa con altri servizi Python del progetto;
- casi in cui il contratto dati lato backend è già su `lpft_shared`.

### Entry points principali

- `services/api/lpft_api/main.py`
  - Avvio API/FastAPI
- `services/api/lpft_api/assistant.py`
  - Orchestrazione assistant lato API
- `services/api/lpft_api/strategy_spec_tool.py`
  - Tool strategy-spec lato Python
- `services/shared/lpft_shared/engine.py`
  - Motore shared Python
- `services/shared/lpft_shared/tier1/`
  - CPCV, DSR, fractional diff (FFD), Monte Carlo 10k, CVaR
- `services/shared/lpft_shared/market_data.py`
  - Accesso dati mercato nel path Python

### Caratteristiche operative

- Boundary chiaro di servizio (HTTP API).
- Migliore fit per integrazioni backend e automazioni.
- Runtime indipendente dal frontend web.

## Regola pratica di selezione

- **Chat web (`/`)** -> preferire **TS event-driven**.
- **Servizi API/worker su `:8000`** -> preferire **Python `lpft_shared`**.

Se il requisito nasce in UI ma richiede successivamente hardening lato servizio, pianificare una migrazione controllata come fase successiva (fuori scope Phase A).

## Importante (Phase A)

- Nessun merge tra engine in questa fase.
- Nessuna unificazione forzata dei modelli interni.
- Obiettivo: chiarezza del routing tecnico e riduzione ambiguità tra path chat e path API.
