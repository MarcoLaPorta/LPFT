# AFX Smart Contracts (Foundry)

Vault ERC-4626 con RBAC **OWNER** (utente) / **MANAGER** (keeper backend) e deploy clone **EIP-1167**.

## Setup

```bash
cd packages/contracts

# Install Foundry: https://book.getfoundry.sh/getting-started/installation
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Dipendenze OpenZeppelin
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
forge install OpenZeppelin/openzeppelin-contracts-upgradeable@v5.0.2 --no-commit

forge build
forge test
```

## Contratti

| File | Ruolo |
|------|--------|
| `src/SmartVault.sol` | ERC-4626 upgradeable; deposit/withdraw `onlyOwner`; `executeTrade` `onlyManager` |
| `src/VaultFactory.sol` | `Clones.clone(implementation)` + `initialize` per utente |
| `src/mocks/MockTokens.sol` | MockUSDC (6 dec), MockQQQ, MockGLD, MockDexRouter |
| `src/interfaces/ISmartVault.sol` | Interfaccia + eventi |

## RBAC

- **OWNER** (`Ownable`): `deposit`, `mint`, `withdraw`, `redeem`, `setRouterWhitelisted`
- **MANAGER** (`manager` immutabile per clone): `executeTrade` → solo verso `whitelistedRouters`

## executeTrade payload

```solidity
bytes memory dexPayload = abi.encode(routerAddress, swapCalldata);
vault.executeTrade(assetIn, assetOut, amountIn, dexPayload);
```

## Deploy locale / Anvil

```bash
anvil &
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export MANAGER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

Allinea `AFX_VAULT_FACTORY_ADDRESS` in `apps/web/.env.local` con l'indirizzo `VaultFactory` emesso.

## Arbitrum Sepolia (testnet pubblica)

```bash
cd packages/contracts
cp .env.example .env
# PRIVATE_KEY, MANAGER_ADDRESS, ARBITRUM_SEPOLIA_RPC_URL

./scripts/deploy-arbitrum-sepolia.sh

cd ../../apps/web
npm run deploy:parse-forge -- 421614
# → incolla output in .env.local, MANAGER_PRIVATE_KEY, AFX_ONCHAIN_CONFIRM_MODE=real
npm run seed:web3 && npm run dev:restart
```

Guida completa: [`docs/DEPLOY_ARBITRUM_SEPOLIA.md`](../../docs/DEPLOY_ARBITRUM_SEPOLIA.md)

### Liquidità Uniswap V3 (pre-test Keeper)

```bash
./scripts/setup-sepolia-liquidity.sh check    # verifica pool USDC/WETH
./scripts/setup-sepolia-liquidity.sh deposit  # finanzia vault (OWNER)
```

Coppia liquida su Sepolia: **USDC** `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` → **WETH** `0x1bdc540dEB9Ed1fA29964DeEcCc524A8f5e2198e` (fee 0.3%).

## Chain target MVP

- Local: Anvil `31337`
- Testnet: Arbitrum Sepolia `421614`
