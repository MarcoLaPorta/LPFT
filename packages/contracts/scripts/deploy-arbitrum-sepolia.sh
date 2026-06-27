#!/usr/bin/env bash
# Deploy AFX su Arbitrum Sepolia (421614).
# Prerequisiti: foundry, .env con PRIVATE_KEY + MANAGER_ADDRESS + ARBITRUM_SEPOLIA_RPC_URL
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Crea packages/contracts/.env da .env.example"
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${PRIVATE_KEY:?PRIVATE_KEY mancante in .env}"
: "${MANAGER_ADDRESS:?MANAGER_ADDRESS mancante in .env}"
: "${ARBITRUM_SEPOLIA_RPC_URL:?ARBITRUM_SEPOLIA_RPC_URL mancante in .env}"

echo "Deploy su Arbitrum Sepolia (chain 421614)…"
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARBITRUM_SEPOLIA_RPC_URL" \
  --broadcast \
  --chain-id 421614 \
  -vvv

echo ""
echo "Indirizzi in broadcast/Deploy.s.sol/421614/run-latest.json"
echo "Genera righe .env.local:"
echo "  cd ../../apps/web && npm run deploy:parse-forge -- 421614"
