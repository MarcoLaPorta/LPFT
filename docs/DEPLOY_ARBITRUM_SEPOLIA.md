# Deploy AFX su Arbitrum Sepolia (testnet)

Passo successivo dopo Anvil locale: contratti reali su **chain 421614**, wallet MetaMask su Arbitrum Sepolia, keeper che firma on-chain.

## Prerequisiti

1. **Foundry** installato (`foundryup`)
2. Wallet con **ETH Sepolia** su Arbitrum Sepolia ([faucet](https://faucet.quicknode.com/arbitrum/sepolia))
3. Stessa wallet (o due EOA) per:
   - **Deployer** (`PRIVATE_KEY`)
   - **MANAGER / Keeper** (`MANAGER_ADDRESS` + `MANAGER_PRIVATE_KEY` in `apps/web/.env.local`)

## 1. Deploy contratti

```bash
cd packages/contracts
cp .env.example .env
# Compila PRIVATE_KEY, MANAGER_ADDRESS, ARBITRUM_SEPOLIA_RPC_URL

chmod +x scripts/deploy-arbitrum-sepolia.sh
./scripts/deploy-arbitrum-sepolia.sh
```

Output forge: `MockUSDC`, `MockDexRouter`, `VaultFactory`, `MANAGER`.

## 2. Aggiorna `apps/web/.env.local`

```bash
cd apps/web
npm run deploy:parse-forge -- 421614
```

Copia le righe stampate in `.env.local` e aggiungi:

```env
AFX_MANAGER_ADDRESS=0x...          # stesso MANAGER del deploy
MANAGER_PRIVATE_KEY=0x...          # chiave del MANAGER (non committare)
AFX_ONCHAIN_CONFIRM_MODE=real
```

Opzionale: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` da [WalletConnect Cloud](https://cloud.walletconnect.com) per mobile.

## 3. DB + app

```bash
cd apps/web
npm run seed:web3          # whitelist router per chainId in .env
npm run dev:restart
```

## 4. MetaMask

- Rete: **Arbitrum Sepolia** (predefinita in MetaMask)
- Chain ID **421614**
- Connetti da **Connect Wallet** → **Browser Wallet**

## 5. Flusso utente

1. `/vault` → **Crea vault** → **Deposita** mUSDC (faucet: `mint` su MockUSDC se serve — da console cast o script)
2. Chat → backtest → **Conferma esecuzione**
3. Keeper (terminale separato):

```bash
cd apps/web
npm run keeper
# oppure loop: SWEEP_INTERVAL_MS=5000 npm run keeper:loop
```

4. Verifica `ExecutionLog` → `CONFIRMED` + `transactionHash` su [Arbiscan Sepolia](https://sepolia.arbiscan.io/)

## Faucet mUSDC (test)

Dopo deploy, il deployer può mintare MockUSDC all’OWNER:

```bash
cast send <MOCK_USDC> "mint(address,uint256)" <TUO_WALLET> 1000000000 \
  --rpc-url $ARBITRUM_SEPOLIA_RPC_URL --private-key $PRIVATE_KEY
```

(`1000000000` = 1000 USDC con 6 decimali)

## Torna ad Anvil locale

```env
NEXT_PUBLIC_AFX_CHAIN_ID=31337
AFX_CHAIN_ID=31337
# ... indirizzi da broadcast/31337
```

Poi `npm run deploy:parse-forge -- 31337` e `npm run dev:restart`.

## Setup liquidità (obbligatorio prima del primo swap)

```bash
cd packages/contracts
./scripts/setup-sepolia-liquidity.sh all
# oppure: check | balances | deposit
```

Vedi `packages/contracts/config/arbitrum-sepolia.json` per indirizzi USDC/WETH/pool.

**Router Sepolia:** `0x101F443B4d1b059569D643917553c771E1b9663E` (non usare `0x68b346…` — vuoto su Sepolia).

## Keeper Uniswap V3

- Router whitelist: **SwapRouter02 Arbitrum Sepolia** `0x101F443B4d1b059569D643917553c771E1b9663E`
- Keeper genera `exactInputSingle` con `recipient` = indirizzo vault
- Sizing da `payloadJson.sizing` (o fallback `AFX_KEEPER_TRADE_AMOUNT`)

## Limitazioni MVP

- `amountOutMinimum = 0` finché non c’è oracle (slippage on-chain non protetto)
- Serve pool Uniswap V3 liquido per la coppia tokenIn/tokenOut su Sepolia
- Strategie quant (Yahoo/Alpaca) restano **backtest**; on-chain valida solo vault + RBAC + keeper
