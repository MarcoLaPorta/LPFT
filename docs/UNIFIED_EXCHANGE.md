# Agentic Finance Exchange — progetto unico (LPFT come base)

## Principio

Non esistono due prodotti concorrenti nello stesso monorepo: c’è **un solo exchange agentico** in costruzione. **LPFT** non viene abbandonato: è il **nucleo già investito** (dati di mercato, motore di backtest, generazione strategia/intent con LLM, qualità dati, coda RQ). **AFX** non lo sostituisce: aggiunge il **layer exchange** — persistenza PostgreSQL/Prisma (wallet, vault, policy DEX, RFQ, **ExecutionLog** per RLFF), Web3, firma manager — **integrata nella stessa app Next** (`apps/web`).

In sintesi:

| Strato | Dove vive oggi | Ruolo nel prodotto unico |
|--------|----------------|---------------------------|
| Ricerca & intent | `services/api`, `services/shared`, `apps/web` | Generazione e validazione intent/strategie, simulazione storica, metriche. |
| Exchange & audit | **`apps/web`** (Prisma in `apps/web/prisma`, route `/exchange`, API `/api/health`, `/api/chat`, ecc.) | Stato on-chain/off-chain, policy, log esecuzioni per RLFF; stesso origin su **porta 3000**. |
| Infra condivisa | `infra/`, Redis, Postgres | Stesso cluster: DB `lpft` (SQLModel) e DB dedicato AFX (Prisma), stesso Redis per code ed eventi. |

## Direzione di integrazione (senza buttare via nulla)

1. **Intent pipeline** — Gli output qualificati di LPFT (spec, programma, ragionamento, simbolo, vincoli di rischio) diventano input canonici per la creazione/aggiornamento di `ExecutionLog` e per il routing (primario / RFQ / AMM), via API condivise o eventi Redis (vedi roadmap architettura event-driven).
2. **Un fronte unico** — **Un solo Next** su **:3000**: home LPFT, **`/exchange`** (stato Prisma). L’endpoint **`/api/chat`** resta disponibile per agenti AFX (Anthropic + tool) senza una seconda pagina “terminale”. Non serve una seconda app sulla :3001.
3. **Dati** — Postgres per LPFT (`lpft`) e Prisma per AFX (database separato, es. `afx_dev`): `DATABASE_URL` in **`apps/web/.env.local`**; `LPFT_DATABASE_URL` in **`services/api/.env.local`**.
4. **Contratti e signer** — Solidity e servizio firma (KMS) si agganciano al modello AFX già definito in Prisma; il motore LPFT continua a fornire **PnL/simulazione** che alimentano `pnlResult` negli execution log.

## Cosa non fare

- Non deprecare LPFT come “solo laboratorio”: è il **motore quantitativo e conversazionale** dello stesso prodotto.
- Non duplicare la chat o il motore OHLCV: si **riusa** `lpft_shared` e l’API LPFT dove possibile.

Questo file è la linea guida architetturale; le modifiche di codice seguono questa direzione in incrementi (event bus, route unificate, ecc.).

---

## On-chain roadmap (mainnet readiness checklist)

- [ ] **Chain config production**: valorizzare `AFX_CHAIN_ID` e `AFX_VAULT_FACTORY_ADDRESS` con deployment verificati.
- [ ] **Vault deploy API**: implementare `POST /api/vault/deploy` con validazioni policy + persistenza `SmartVault`.
- [ ] **Signer reale**: completare integrazione `createKmsSigner()` (provider KMS/HSM), audit log e fallback operativo.
- [ ] **RPC confirmation path**: sostituire `confirmOnChainReal` nel sweeper con provider RPC, receipt parsing e retry policy.
- [ ] **Security hardening**: rate limit API sensibili, allowlist router/factory per chain, monitoraggio error budget.
- [ ] **Operational readiness**: runbook incidenti, alerting tx stuck/failed, testnet rehearsal prima del cutover mainnet.

---

## Blockchain (decisione aperta)

L’architettura è **chain-agnostic** a livello dati: `chainId`, indirizzi factory/router e vault sono già modellati in Prisma; l’exchange resta **non-custodial** indipendentemente dalla L1/L2 scelta. La scelta della catena impatta: costi gas, finalità, disponibilità di **oracoli** (Chainlink/Pyth) e **DEX** da mettere in whitelist, e il profilo di fiducia sul **sequencer** (rollup) vs Ethereum L1. Documento visivo riassuntivo delle schermate + matrice comparativa: apri la **Canvas** `canvases/afx-lpft-ui-overview.canvas.tsx` accanto alla chat.

---

## Implementato: bus intent, signer, oracoli mock, idempotenza, sweeper

- **Task 2 — Redis:** `lpft_api/intent_publisher.py` pubblica su `LPFT_AFX_INTENTS_CHANNEL` (default `afx:intents:new`) dopo `/generate-strategy`, stream `/generate-strategy-stream` e `/generate-and-backtest` se `LPFT_AFX_INTENTS_ENABLED=true`. Consumer: **`cd apps/web && npm run worker:intents`** (`scripts/intent-listener.ts`): carica `DATABASE_URL` + `LPFT_REDIS_URL` (o `REDIS_URL`), valida `router_address`+`chain_id` contro `WhitelistedDexRouter` se entrambi presenti (altrimenti scarta); crea `ExecutionLog` con stato **PENDING** se la whitelist passa, altrimenti **LOGGED_PROPOSAL** per intent senza router (tipico LPFT); `idempotency_key` dal payload.
- **Task 3 — Signer:** `apps/web/lib/services/signer.ts` — interfaccia `KeyManagementService` + `createMockKmsSigner` (nessuna chiave privata in chiaro).
- **Task 4 — Oracoli / DEX friction:** `lpft_shared/market_data.py` — classi mock Chainlink/Pyth-style e `suggested_dex_execution_overhead()`. `ProgramMetadata` in `engine.py`: `onchain_latency_bars`, `dex_synthetic_spread_bps` sommati a latenza e spread simulati.
- **Task 5 — Idempotenza + sweeper:** Prisma `ExecutionLog.idempotencyKey` obbligatorio univoco; enum `PENDING`; migrazione `20260215120000_pending_idempotency`; seed utente ponte `cmfnhlpftbridge0000000001`. `npm run sweep` in **`apps/web`** (`scripts/sweep-execution-logs.ts`) aggiorna PENDING → CONFIRMED/FAILED con esito on-chain **mock**.

**Migrazione Prisma AFX:** da `apps/web`:

```bash
cd apps/web && npx prisma migrate deploy
```

(sul database configurato in `DATABASE_URL`, es. `afx_dev`).

### Cartella `agentic-finance-exchange/`

Storico / riferimento: il codice operativo del layer AFX nella UI è stato **unito in `apps/web`**. Non avviare una seconda istanza Next per l’exchange.
