# LPFT · Agentic Finance Exchange (AFX)

**Agentic Finance Exchange** è un exchange quantitativo non-custodial: l’utente dialoga con un agente fiduciario (Claude), ottiene backtest e report istituzionali, e — dopo conferma esplicita — può eseguire strategie on-chain tramite uno **SmartVault** personale.

Il repository unifica tre pilastri in un unico prodotto:

| Pilastro | Ruolo |
|----------|--------|
| **IA** | Assistente quant in chat con tool specializzati (analisi, build strategia, backtest, proposta esecuzione) |
| **Backtest** | Motori quant TypeScript (interattivo) + Python (validazione Tier-1), dati Alpaca/Yahoo |
| **DeFi** | SmartVault ERC-4626, keeper Web3, Uniswap V3 e mercato primario RWA su testnet |

L’app operativa è **`apps/web`** (Next.js, porta **3000**). LPFT Python su **:8000** è opzionale ma consigliato per validazione istituzionale e backtest in coda.

---

## Architettura

```
Utente (browser + MetaMask)
        │
        ▼
   apps/web :3000
        │
        ├── Chat IA (Claude + Vercel AI SDK)
        │     └── tool → backtest TS → report → proposeExecution
        │
        ├── PostgreSQL (Prisma, afx_dev)
        │     └── ExecutionLog, SmartVault, StrategySnapshot, MarketDataBar
        │
        ├── Keeper (web3-keeper.ts, viem)
        │     └── SmartVault.executeTrade
        │
        ├── services/api :8000 (opzionale)
        │     └── lpft_shared: backtest coda RQ, CPCV, DSR, Monte Carlo, CVaR
        │
        └── Arbitrum Sepolia 421614 (testnet)
              ├── SmartVault (ERC-4626, clone EIP-1167)
              ├── Uniswap V3 SwapRouter02 + QuoterV2
              └── MockRwaPrimary (mint RWA testnet)
```

**Principio:** LPFT (ricerca quant Python) e AFX (exchange + chat + on-chain) non sono prodotti separati — condividono lo stesso frontend e lo stesso flusso utente. La cartella `agentic-finance-exchange/` è solo archivio storico.

---

## Infrastruttura IA

### Agente fiduciario

- **Route:** `/` — componente `FiduciaryChat`
- **API:** `POST /api/chat` — streaming Anthropic via Vercel AI SDK
- **Modello:** Claude (`AFX_ANTHROPIC_MODEL`, default `claude-sonnet-4-20250514`)
- **Prompt:** `lib/afx-fiduciary-prompt.ts` — versione `afx-fiduciary-v3-tier1` con istruzioni DSR, CPCV, CVaR, Point-in-Time, regime stress, Kelly
- **Caching:** `lib/afx-anthropic-cache.ts` — prompt caching su system + tool `buildQuantitativeStrategy`

### Tool disponibili (`lib/afx-chat-tools.ts`)

| Tool | Funzione |
|------|----------|
| `analyzeMarketData` | OHLCV Yahoo/Alpaca prima di ogni proposta |
| `buildQuantitativeStrategy` | JSON strategia → compiler → backtest event-driven → snapshot report |
| `runStrategyBacktest` | Backtest semplice (buy & hold, drawdown-to-stable) |
| `proposeExecution` | Crea `ExecutionLog` DRAFT dopo backtest + guardrail Sharpe/drawdown |
| `executeTrade` / `executeSwap` | Solo dopo conferma utente in UI |

### Persistenza chat

- Conversazioni e messaggi su Prisma (`Conversation`, `Message`)
- Ogni proposta esecuzione tracciata in `ExecutionLog` con `promptVersion`, metriche e payload per **RLFF** (Reinforcement Learning from Feedback)
- Feedback utente: `POST /api/execution/[id]/feedback`

### Variabili IA

```env
ANTHROPIC_API_KEY=          # obbligatorio per la chat
AFX_ANTHROPIC_MODEL=
AFX_PROMPT_CACHE=true         # disabilita: false
DATABASE_URL=                 # PostgreSQL afx_dev
```

---

## Infrastruttura backtest

Due motori quant **coesistono** — servono percorsi diversi, senza merge forzato del codice.

### Engine 1 — TypeScript (path chat, prioritario in UI)

Usato quando il flusso parte dalla chat e serve risposta rapida con widget e report.

| Modulo | Percorso | Ruolo |
|--------|----------|--------|
| Tool orchestration | `lib/afx-chat-tools.ts` | Entry point chat |
| Compiler | `lib/afx-quant-compiler.ts` | JSON LLM → config engine |
| Event-driven engine | `services/quant/event-driven-engine.ts` | Loop giornaliero: segnali T+1, risk halt, mark-to-market |
| Signal engine | `services/quant/signal-engine.ts` | Momentum, RSI, equal weight, session mask RTH |
| Risk manager | `services/quant/risk-manager.ts` | Max drawdown, stop loss, trailing stop |
| Backtest | `services/quant/backtest.ts` | Orchestrazione + metriche (CAGR, Sharpe, drawdown) |
| HFT engine | `services/quant/hft-engine.ts` | Microstructure, limit queue, toxicity |
| Tick replay | `services/market_data/tick-replay-engine.ts` | Replay tick Alpaca → HFT (`AFX_HFT_REPLAY=alpaca`) |
| Market data | `services/market_data/router.ts` | Equity USA / HFT → Alpaca; crypto/macro → Yahoo |
| Cache | `MarketDataBar` (Prisma) | Persistenza OHLCV per replay |

**Tier-1 integrato in TS:** PiT (`pit-proxy.ts`), regime stress (`regime-analysis.ts`), fractional Kelly (`kelly-sizing.ts`).

**Output:** equity series, trade registry, KPI, snapshot → `/analysis/[id]` via `StrategyReportView`.

### Engine 2 — Python `lpft_shared` (path API :8000)

Usato per validazione istituzionale, worker RQ e integrazioni backend.

| Modulo | Percorso | Ruolo |
|--------|----------|--------|
| API | `services/api/lpft_api/main.py` | FastAPI |
| Engine | `services/shared/lpft_shared/engine.py` | Backtest program DSL |
| Tier-1 | `services/shared/lpft_shared/tier1/` | CPCV, DSR, FFD, Monte Carlo 10k, CVaR |
| Worker | `services/worker/` | Consumer RQ Redis per backtest in coda |
| Bridge Next | `lib/lpft-tier1.ts` | Proxy verso `POST /quant/tier1/validate` |

**Endpoint Python principali:**

- `POST /generate-strategy`, `POST /generate-and-backtest`
- `POST /quant/tier1/validate`, `POST /quant/tier1/monte-carlo`
- Proxy Next: `POST /api/quant/tier1-validate`, `POST /api/quant/backtest`

### Regola di selezione

| Contesto | Engine |
|----------|--------|
| Chat web `/` | TypeScript event-driven (o HFT per scalp) |
| API/worker `:8000` | Python `lpft_shared` |
| Validazione CPCV/DSR pesante | Python Tier-1 |
| Esecuzione on-chain | Keeper AFX (indipendente dal motore backtest) |

Il backtest resta **off-chain**; l’on-chain esegue solo il trade sizing confermato dall’utente.

### Dati di mercato

- **Alpaca** — equity USA, tick/quote per HFT (`ALPACA_API_KEY`, `ALPACA_API_SECRET`)
- **Yahoo Finance** — crypto, macro, fallback
- **Due database Postgres:** `lpft` (API Python) e `afx_dev` (Prisma AFX) — stesso host Docker, schema separati

---

## Infrastruttura DeFi

### Modello non-custodial

| Ruolo | Chi | Permessi |
|-------|-----|----------|
| **OWNER** | Wallet utente (MetaMask) | `deposit`, `withdraw` sul SmartVault |
| **MANAGER** | EOA keeper backend | `executeTrade` solo verso router whitelisted |

L’utente non delega la custodia al backend: il keeper può solo instradare trade verso DEX/router autorizzati.

### Smart contracts (`packages/contracts`)

| Contratto | Ruolo |
|-----------|--------|
| `SmartVault.sol` | ERC-4626 upgradeable; RBAC OWNER/MANAGER |
| `VaultFactory.sol` | Clone EIP-1167 per utente |
| `MockRwaPrimary.sol` | Mercato primario testnet: USDC → mint RWA 1:1 nominale |
| `MockTokens.sol` | MockUSDC, MockDexRouter (solo Anvil locale) |

### Market routing (`lib/afx-market-routing.ts`)

| Asset | Condizione | Mode | On-chain |
|-------|------------|------|----------|
| Crypto (BTC, ETH, …) | — | `SECONDARY_AMM` | Uniswap V3 `exactInputSingle` |
| Equity/ETF (SPY, AAPL) | Orario US (RTH) | `PRIMARY_MINT_BURN` | `MockRwaPrimary.mintRwa` |
| Equity/ETF | Fuori orario US | `PRIMARY_RFQ_ATOMIC` | Mint primario + spread RFQ +0.3% |

### Flusso esecuzione

```
Chat → proposeExecution → ExecutionLog DRAFT
    → UI (importo USDC obbligatorio)
    → POST /api/execution/[id]/execute → SUBMITTED
    → npm run keeper:loop
    → web3-keeper.ts → SmartVault.executeTrade → CONFIRMED | FAILED
```

**Sizing** (`lib/services/execution-sizing.ts`): calcolato in `payloadJson.sizing` — nessun fallback env. L’utente sovrascrive `amountIn` via widget; slippage **0.5%** via QuoterV2 su crypto.

**Keeper** (`lib/services/web3-keeper.ts`):

- Crypto: QuoterV2 `0x2779a0C1EFA37FB27C5B2FceD20B0D1EB508778C`, router `0x101F443B4d1b059569D643917553c771E1b9663E`
- RWA: `MockRwaPrimary` whitelisted in DB (`npm run seed:web3`, `npm run seed:rwa`)

**Modalità:**

| Env | Comportamento |
|-----|---------------|
| `AFX_ONCHAIN_CONFIRM_MODE=mock` | Hash tx fittizio (Anvil locale) |
| `AFX_ONCHAIN_CONFIRM_MODE=real` | Tx reali con `MANAGER_PRIVATE_KEY` |

### UI DeFi

| Route | Funzione |
|-------|----------|
| `/vault` | Deploy vault, approve USDC, deposit, sync on-chain → Prisma |
| `/exchange` | Quote mercati, watchlist |
| `/analysis/[id]` | Report + `ReportExecutionConfirm` |

---

## Struttura monorepo

| Percorso | Ruolo |
|----------|--------|
| `apps/web/` | App principale — UI, API route, Prisma, keeper, motori quant TS |
| `services/api/` | API Python LPFT |
| `services/shared/` | Libreria `lpft_shared` |
| `services/worker/` | Worker RQ backtest |
| `packages/contracts/` | Smart contracts Foundry |
| `infra/` | Docker Compose (Postgres, Redis) |
| `scripts/start-lpft.sh` | Avvio rapido API + Next |

---

## Avvio locale

### Un comando (consigliato)

```bash
./scripts/start-lpft.sh
# oppure: npm start
```

Avvia Postgres/Redis (Docker se disponibile), API :8000 e Next :3000.

### Setup manuale

**1. Infra**

```bash
cd infra && docker compose up -d postgres redis
```

**2. Database AFX**

```bash
cd apps/web
cp env.local.template .env.local   # compila DATABASE_URL, ANTHROPIC_API_KEY
npx prisma migrate deploy
npm install && npm run dev
```

**3. API Python (opzionale)**

```bash
cd services/api
cp env.local.template .env.local   # LPFT_DATABASE_URL, LPFT_ANTHROPIC_API_KEY
source .venv/bin/activate
uvicorn lpft_api.main:app --reload --host 0.0.0.0 --port 8000
```

**4. Worker RQ (opzionale, con Redis)**

```bash
cd services/worker
LPFT_REDIS_URL=redis://localhost:6379/0 python -m lpft_worker.worker
```

**5. Keeper (testnet/on-chain)**

```bash
cd apps/web
npm run seed:web3 && npm run seed:rwa
npm run keeper:loop
```

| Servizio | Porta | URL |
|----------|-------|-----|
| Frontend | 3000 | http://127.0.0.1:3000 |
| API Python | 8000 | http://localhost:8000/docs |
| Postgres | 5432 | user/pass `lpft`/`lpft`, DB `lpft` + `afx_dev` |
| Redis | 6379 | — |

---

## Testnet Arbitrum Sepolia (421614)

**Prerequisiti:** Foundry, ETH Sepolia, USDC nativo (`0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`).

```bash
# 1. Deploy contratti
cd packages/contracts
cp .env.example .env   # PRIVATE_KEY, MANAGER_ADDRESS, ARBITRUM_SEPOLIA_RPC_URL
./scripts/deploy-arbitrum-sepolia.sh

# 2. Config app
cd ../../apps/web
npm run deploy:parse-forge -- 421614
# incolla output in .env.local + MANAGER_PRIVATE_KEY + AFX_ONCHAIN_CONFIRM_MODE=real

# 3. Seed DB
npx prisma migrate deploy
npm run seed:web3 && npm run seed:rwa

# 4. Liquidità Uniswap (primo swap crypto)
cd ../../packages/contracts
./scripts/setup-sepolia-liquidity.sh check

# 5. Avvia app + keeper
cd ../../apps/web
npm run dev:restart          # terminale 1
npm run keeper:loop          # terminale 2
```

Flusso utente: `/vault` → deposit USDC → chat → backtest → conferma importo USDC → keeper → `CONFIRMED` su [Arbiscan Sepolia](https://sepolia.arbiscan.io/).

**Anvil locale (31337):** deploy con `forge script`, `npm run deploy:parse-forge -- 31337`, `AFX_ONCHAIN_CONFIRM_MODE=mock`.

---

## Configurazione e sicurezza

**Non committare** file con segreti (già in `.gitignore`):

| File | Contenuto sensibile |
|------|---------------------|
| `apps/web/.env.local` | `ANTHROPIC_API_KEY`, `DATABASE_URL`, `MANAGER_PRIVATE_KEY` |
| `services/api/.env.local` | `LPFT_ANTHROPIC_API_KEY`, DB, Redis |
| `packages/contracts/.env` | `PRIVATE_KEY` deploy |

Template: `apps/web/env.local.template`, `services/api/env.local.template`, `packages/contracts/.env.example`.

---

## Stato MVP

**Implementato:** chat IA + tool, backtest TS/HFT, validazione Tier-1 Python, report analitici, vault UI, esecuzione testnet crypto (Uniswap) e RWA (MockRwaPrimary), keeper con Quoter, RLFF logging.

**Non production-ready:** KMS signer reale, RFQ atomico on-chain, burn/vendita RWA, mainnet, monitoring operativo.

---

## Licenza

Progetto di ricerca / MVP. Verifica le licenze delle dipendenze (OpenZeppelin, Uniswap, Anthropic, ecc.) prima di qualsiasi uso commerciale.
