# LPFT · Agentic Finance Exchange (AFX)

Exchange agentico non-custodial: chat quant (Claude), backtest, report strategie ed esecuzione on-chain su **SmartVault** (Arbitrum Sepolia testnet).

## Stack

| Layer | Tecnologia |
|-------|------------|
| Frontend | Next.js 15, React 19, Tailwind, RainbowKit/wagmi |
| Chat IA | Vercel AI SDK + Anthropic Claude |
| Quant (UX) | TypeScript event-driven + HFT engine |
| Quant (Tier-1) | Python FastAPI `:8000` (CPCV, DSR, MC) |
| DB | PostgreSQL + Prisma (`apps/web/prisma`) |
| Web3 | Foundry, SmartVault ERC-4626, Uniswap V3, MockRwaPrimary |

## Avvio rapido

```bash
# 1. Infra (Postgres + Redis)
cd infra && docker compose up -d postgres redis

# 2. App AFX
cd apps/web
cp env.local.template .env.local   # compila a mano — NON committare
npm install
npx prisma migrate deploy
npm run dev                        # http://127.0.0.1:3000

# 3. (Opzionale) API Python LPFT
cd services/api && uvicorn lpft_api.main:app --reload --port 8000
```

Guida completa: [`AVVIO.md`](AVVIO.md)

## Esecuzione testnet (Arbitrum Sepolia)

1. Deploy contratti: [`docs/DEPLOY_ARBITRUM_SEPOLIA.md`](docs/DEPLOY_ARBITRUM_SEPOLIA.md)
2. `.env.local`: chain `421614`, factory, router, RWA, `MANAGER_PRIVATE_KEY`, `AFX_ONCHAIN_CONFIRM_MODE=real`
3. `npm run seed:web3 && npm run seed:rwa`
4. `/vault` → crea vault + deposita USDC test
5. Chat → proposeExecution → conferma importo → `npm run keeper:loop`

- **Crypto** → Uniswap V3 (USDC → WETH)
- **RWA / equity** → MockRwaPrimary (USDC → mQQQ/mGLD)

## Documentazione

- [`docs/UNIFIED_EXCHANGE.md`](docs/UNIFIED_EXCHANGE.md) — architettura prodotto
- [`docs/QUANT_ENGINES.md`](docs/QUANT_ENGINES.md) — motori quant TS vs Python
- [`packages/contracts/README.md`](packages/contracts/README.md) — smart contracts

## Sicurezza — cosa NON va su GitHub

I seguenti file restano **solo in locale** (già in `.gitignore`):

- `apps/web/.env.local` — `ANTHROPIC_API_KEY`, `DATABASE_URL`, `MANAGER_PRIVATE_KEY`
- `services/api/.env.local` — chiavi API e DB
- `packages/contracts/.env` — `PRIVATE_KEY` deploy

Usa sempre i template: `apps/web/env.local.template`, `services/api/env.local.template`.

## Licenza

Progetto di ricerca / MVP. Verifica licenze dipendenze (OpenZeppelin, Uniswap, ecc.) prima di uso commerciale.
