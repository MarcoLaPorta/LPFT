# LPFT · Agentic Finance Exchange (AFX)

> **Repository pubblico a scopo dimostrativo.**  
> Il codice illustra l’architettura del prodotto; non include istruzioni di deploy, configurazione operativa né materiali per l’esecuzione in locale o su testnet.

**Agentic Finance Exchange** è un exchange quantitativo non-custodial: l’utente dialoga con un agente fiduciario (Claude), ottiene backtest e report istituzionali, e — dopo conferma esplicita — può eseguire strategie on-chain tramite uno **SmartVault** personale.

Il repository unifica tre pilastri in un unico prodotto:

| Pilastro | Ruolo |
|----------|--------|
| **IA** | Assistente quant in chat con tool specializzati (analisi, build strategia, backtest, proposta esecuzione) |
| **Backtest** | Motori quant TypeScript (interattivo) + Python (validazione Tier-1), dati Alpaca/Yahoo |
| **DeFi** | SmartVault ERC-4626, keeper Web3, Uniswap V3 e mercato primario RWA su testnet |

L’app operativa è **`apps/web`** (Next.js). LPFT Python complementa la validazione istituzionale e i backtest in coda.

---

## Architettura

```
Utente (browser + MetaMask)
        │
        ▼
   apps/web
        │
        ├── Chat IA (Claude + Vercel AI SDK)
        │     └── tool → backtest TS → report → proposeExecution
        │
        ├── PostgreSQL (Prisma)
        │     └── ExecutionLog, SmartVault, StrategySnapshot, MarketDataBar
        │
        ├── Keeper (web3-keeper.ts, viem)
        │     └── SmartVault.executeTrade
        │
        ├── services/api (Python LPFT)
        │     └── lpft_shared: backtest coda RQ, CPCV, DSR, Monte Carlo, CVaR
        │
        └── L2 testnet (Arbitrum Sepolia)
              ├── SmartVault (ERC-4626, clone EIP-1167)
              ├── Uniswap V3
              └── MockRwaPrimary (mint RWA testnet)
```

**Principio:** LPFT (ricerca quant Python) e AFX (exchange + chat + on-chain) condividono lo stesso frontend e lo stesso flusso utente.

---

## Infrastruttura IA

### Agente fiduciario

- Chat principale con streaming Anthropic via Vercel AI SDK
- Prompt istituzionale con istruzioni DSR, CPCV, CVaR, Point-in-Time, regime stress, Kelly
- Prompt caching su system message e tool di build strategia

### Tool disponibili

| Tool | Funzione |
|------|----------|
| `analyzeMarketData` | OHLCV Yahoo/Alpaca prima di ogni proposta |
| `buildQuantitativeStrategy` | JSON strategia → compiler → backtest event-driven → snapshot report |
| `runStrategyBacktest` | Backtest semplice (buy & hold, drawdown-to-stable) |
| `proposeExecution` | Crea proposta esecuzione dopo backtest + guardrail Sharpe/drawdown |
| `executeTrade` / `executeSwap` | Solo dopo conferma utente in UI |

### Persistenza e miglioramento

- Conversazioni e messaggi persistiti su database relazionale
- Ogni proposta tracciata in `ExecutionLog` con metriche e payload per **RLFF** (Reinforcement Learning from Feedback)
- Feedback utente integrato nel ciclo di audit

---

## Infrastruttura backtest

Due motori quant **coesistono** — servono percorsi diversi, senza merge forzato del codice.

### Engine TypeScript (path chat)

Usato quando il flusso parte dalla chat e serve risposta rapida con widget e report.

| Area | Ruolo |
|------|--------|
| Event-driven engine | Loop giornaliero: segnali T+1, risk halt, mark-to-market |
| Signal engine | Momentum, RSI, equal weight, session mask RTH |
| Risk manager | Max drawdown, stop loss, trailing stop |
| HFT engine | Microstructure, limit queue, toxicity |
| Tick replay | Replay tick verso motore HFT |
| Market data router | Equity USA / HFT → Alpaca; crypto/macro → Yahoo |

**Tier-1 integrato in TS:** Point-in-Time, regime stress, fractional Kelly.

**Output:** equity series, trade registry, KPI, report analitico persistente.

### Engine Python `lpft_shared` (path API)

Usato per validazione istituzionale, worker in coda e integrazioni backend.

| Area | Ruolo |
|------|--------|
| FastAPI | API ricerca e generazione strategia |
| Engine | Backtest program DSL |
| Tier-1 | CPCV, DSR, FFD, Monte Carlo, CVaR |
| Worker RQ | Backtest asincroni |

### Regola di selezione

| Contesto | Engine |
|----------|--------|
| Chat web | TypeScript event-driven (o HFT per scalp) |
| API / worker | Python `lpft_shared` |
| Validazione CPCV/DSR pesante | Python Tier-1 |
| Esecuzione on-chain | Keeper AFX (indipendente dal motore backtest) |

Il backtest resta **off-chain**; l’on-chain esegue solo il trade confermato dall’utente.

---

## Infrastruttura DeFi

### Modello non-custodial

| Ruolo | Chi | Permessi |
|-------|-----|----------|
| **OWNER** | Wallet utente | Deposito e prelievo sul SmartVault |
| **MANAGER** | Keeper backend | `executeTrade` solo verso router whitelisted |

L’utente non delega la custodia al backend: il keeper può solo instradare trade verso DEX/router autorizzati.

### Smart contracts

| Contratto | Ruolo |
|-----------|--------|
| `SmartVault.sol` | ERC-4626 upgradeable; RBAC OWNER/MANAGER |
| `VaultFactory.sol` | Clone EIP-1167 per utente |
| `MockRwaPrimary.sol` | Mercato primario testnet: USDC → mint RWA 1:1 nominale |
| `MockTokens.sol` | Asset mock per ambiente locale |

### Market routing

| Asset | Condizione | Percorso |
|-------|------------|----------|
| Crypto | — | AMM secondario (Uniswap V3) |
| Equity/ETF | Orario US (RTH) | Mint primario RWA |
| Equity/ETF | Fuori orario US | RFQ atomico simulato (+ spread) |

### Flusso esecuzione

```
Chat → proposta esecuzione → conferma utente (importo USDC)
    → keeper → SmartVault.executeTrade → conferma on-chain
```

Slippage protetto via quoter DEX su crypto; mint RWA via contratto primario mock su testnet.

### Superfici UI

| Area | Funzione |
|------|----------|
| Chat | Assistente quant e widget interattivi |
| Vault | SmartVault, deposito asset, sync stato |
| Exchange | Quote mercati, watchlist |
| Report analisi | KPI, registro trade, conferma esecuzione |

---

## Struttura monorepo

| Percorso | Ruolo |
|----------|--------|
| `apps/web/` | App principale — UI, API route, Prisma, keeper, motori quant TS |
| `services/api/` | API Python LPFT |
| `services/shared/` | Libreria `lpft_shared` |
| `services/worker/` | Worker RQ backtest |
| `packages/contracts/` | Smart contracts Foundry |

---

## Stato MVP

**Implementato:** chat IA + tool, backtest TS/HFT, validazione Tier-1 Python, report analitici, vault UI, esecuzione testnet crypto e RWA, keeper con quoter, RLFF logging.

**Non production-ready:** KMS signer reale, RFQ atomico on-chain, burn/vendita RWA, mainnet, monitoring operativo.

---

## Licenza

Progetto di ricerca / MVP. Verifica le licenze delle dipendenze (OpenZeppelin, Uniswap, Anthropic, ecc.) prima di qualsiasi uso commerciale.
