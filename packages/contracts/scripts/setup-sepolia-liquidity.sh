#!/usr/bin/env bash
# =============================================================================
# setup-sepolia-liquidity.sh — Prepara test Keeper + Uniswap V3 su Arbitrum Sepolia
# =============================================================================
#
# Prerequisiti:
#   - foundry (cast, forge)
#   - packages/contracts/.env con PRIVATE_KEY, ARBITRUM_SEPOLIA_RPC_URL
#   - ETH Sepolia su Arbitrum (https://faucet.quicknode.com/arbitrum/sepolia)
#   - VaultFactory + vault creato (vedi docs/DEPLOY_ARBITRUM_SEPOLIA.md)
#
# Uso:
#   cd packages/contracts
#   cp .env.example .env   # compila chiavi
#   chmod +x scripts/setup-sepolia-liquidity.sh
#   ./scripts/setup-sepolia-liquidity.sh check          # solo verifica pool
#   ./scripts/setup-sepolia-liquidity.sh deposit        # deposit USDC nel vault
#
# Variabili opzionali (.env):
#   OWNER_PRIVATE_KEY       — chiave OWNER (default: PRIVATE_KEY)
#   VAULT_ADDRESS           — indirizzo clone SmartVault
#   VAULT_FACTORY_ADDRESS   — per leggere asset() del vault
#   DEPOSIT_USDC_AMOUNT     — importo deposit (unità minime, 6 dec), es. 1000000 = 1 USDC
#   AFX_DEX_ROUTER_ADDRESS  — deve essere SwapRouter Sepolia (0x101F443...)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- Indirizzi canonici Arbitrum Sepolia (421614) — verificati on-chain ---
CHAIN_ID=421614
UNISWAP_V3_FACTORY="0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e"
SWAP_ROUTER_SEPOLIA="0x101F443B4d1b059569D643917553c771E1b9663E"
SWAP_ROUTER_MAINNET_STYLE="0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
USDC_NATIVE="0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"
WETH_NATIVE="0x1bdc540dEB9Ed1fA29964DeEcCc524A8f5e2198e"
FEE_TIER=3000
KNOWN_POOL_USDC_WETH="0xD50E85B0D84C75B9382A9B6a9e4372fdfdd12Bb6"

# --- Carica .env ---
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
else
  echo "WARN: .env non trovato — copia da .env.example"
fi

RPC_URL="${ARBITRUM_SEPOLIA_RPC_URL:-https://sepolia-rollup.arbitrum.io/rpc}"
OWNER_KEY="${OWNER_PRIVATE_KEY:-${PRIVATE_KEY:-}}"
MANAGER_ADDR="${MANAGER_ADDRESS:-}"
VAULT="${VAULT_ADDRESS:-}"
FACTORY="${VAULT_FACTORY_ADDRESS:-}"
DEPOSIT_AMOUNT="${DEPOSIT_USDC_AMOUNT:-1000000}"

log() { echo ""; echo "==> $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_cast() {
  command -v cast >/dev/null 2>&1 || die "cast non trovato. Installa Foundry: foundryup"
}

require_rpc() {
  cast chain-id --rpc-url "$RPC_URL" >/dev/null 2>&1 || die "RPC non raggiungibile: $RPC_URL"
}

print_banner() {
  cat <<'EOF'

  AFX — Setup liquidità Arbitrum Sepolia (Uniswap V3)
  -------------------------------------------------
  Coppia consigliata: USDC (in) → WETH (out), fee 0.3%
  Pool nota: 0xD50E85B0D84C75B9382A9B6a9e4372fdfdd12Bb6

EOF
}

print_faucets() {
  cat <<EOF
  Fondi testnet
  ------------
  • ETH gas:     https://faucet.quicknode.com/arbitrum/sepolia
  • USDC:        https://faucet.circle.com/  (rete: Arbitrum Sepolia)
  • WETH:        wrap ETH → WETH.deposit() con cast (vedi sotto)

  IMPORTANTE — Asset del vault AFX
  --------------------------------
  Il Keeper fa swap con tokenIn = asset del vault (ERC-4626 underlying).
  • Se hai deployato con MockUSDC AFX, NON puoi usare la pool USDC nativa Uniswap.
  • Per test reali: redeploy Factory con USDC nativo Sepolia:
      USDC_NATIVE=$USDC_NATIVE
    Poi aggiorna apps/web/.env.local e crea un nuovo vault su /vault.

  Router Uniswap su Sepolia
  -------------------------
  • Corretto:  $SWAP_ROUTER_SEPOLIA
  • SBAGLIATO: $SWAP_ROUTER_MAINNET_STYLE (vuoto su Sepolia!)

  In apps/web/.env.local imposta:
    AFX_DEX_ROUTER_ADDRESS=$SWAP_ROUTER_SEPOLIA
    NEXT_PUBLIC_AFX_USDC_ADDRESS=$USDC_NATIVE
    NEXT_PUBLIC_AFX_CHAIN_ID=421614
    AFX_ONCHAIN_CONFIRM_MODE=real

  Poi: cd apps/web && npm run seed:web3 && npm run dev:restart

EOF
}

cmd_check_pool() {
  log "Verifica pool Uniswap V3 (cast)"
  require_cast
  require_rpc

  local pool
  pool=$(cast call "$UNISWAP_V3_FACTORY" \
    "getPool(address,address,uint24)(address)" \
    "$USDC_NATIVE" "$WETH_NATIVE" "$FEE_TIER" \
    --rpc-url "$RPC_URL")

  echo "Factory:     $UNISWAP_V3_FACTORY"
  echo "USDC:        $USDC_NATIVE"
  echo "WETH:        $WETH_NATIVE"
  echo "Fee tier:    $FEE_TIER (0.3%)"
  echo "Pool:        $pool"

  if [[ "$pool" == "0x0000000000000000000000000000000000000000" ]]; then
    echo ""
    echo "Nessuna pool trovata per USDC/WETH @ 0.3%."
    echo "Crea liquidità su https://app.uniswap.org/ (rete Arbitrum Sepolia)"
    echo "oppure usa un'altra fee tier (500, 10000) e aggiorna il Keeper (fee in payloadJson)."
    return 1
  fi

  local liq t0 t1
  liq=$(cast call "$pool" "liquidity()(uint128)" --rpc-url "$RPC_URL")
  t0=$(cast call "$pool" "token0()(address)" --rpc-url "$RPC_URL")
  t1=$(cast call "$pool" "token1()(address)" --rpc-url "$RPC_URL")
  echo "liquidity(): $liq"
  echo "token0:      $t0"
  echo "token1:      $t1"

  if [[ "$liq" == "0" ]]; then
    echo "WARN: liquidity == 0 — aggiungi LP su Uniswap UI"
    return 1
  fi
  echo "OK: pool attiva con liquidità > 0"

  log "Verifica SwapRouter Sepolia"
  local code_len
  code_len=$(cast code "$SWAP_ROUTER_SEPOLIA" --rpc-url "$RPC_URL" | wc -c | tr -d ' ')
  if [[ "$code_len" -lt 100 ]]; then
    die "SwapRouter Sepolia senza bytecode a $SWAP_ROUTER_SEPOLIA"
  fi
  echo "SwapRouter02 Sepolia OK ($SWAP_ROUTER_SEPOLIA)"

  local wrong_len
  wrong_len=$(cast code "$SWAP_ROUTER_MAINNET_STYLE" --rpc-url "$RPC_URL" | wc -c | tr -d ' ')
  if [[ "$wrong_len" -lt 100 ]]; then
    echo "NOTA: $SWAP_ROUTER_MAINNET_STYLE non deployato su Sepolia (normale)."
  fi
}

cmd_forge_check() {
  log "Verifica pool (forge script)"
  require_cast
  require_rpc
  forge script script/CheckSepoliaPool.s.sol:CheckSepoliaPool --rpc-url "$RPC_URL"
}

cmd_balances() {
  log "Saldi wallet"
  require_cast
  require_rpc
  [[ -n "$OWNER_KEY" ]] || die "Imposta OWNER_PRIVATE_KEY o PRIVATE_KEY in .env"

  local owner
  owner=$(cast wallet address --private-key "$OWNER_KEY")
  echo "Owner: $owner"

  local eth_bal usdc_bal weth_bal
  eth_bal=$(cast balance "$owner" --rpc-url "$RPC_URL")
  usdc_bal=$(cast call "$USDC_NATIVE" "balanceOf(address)(uint256)" "$owner" --rpc-url "$RPC_URL" 2>/dev/null || echo 0)
  weth_bal=$(cast call "$WETH_NATIVE" "balanceOf(address)(uint256)" "$owner" --rpc-url "$RPC_URL" 2>/dev/null || echo 0)

  echo "ETH:  $eth_bal wei"
  echo "USDC: $usdc_bal (6 decimals)"
  echo "WETH: $weth_bal (18 decimals)"

  if [[ "$usdc_bal" == "0" ]]; then
    echo ""
    echo "USDC = 0 → richiedi dal faucet Circle (Arbitrum Sepolia)"
  fi
}

cmd_wrap_eth() {
  log "Wrap 0.001 ETH → WETH (opzionale)"
  require_cast
  require_rpc
  [[ -n "$OWNER_KEY" ]] || die "PRIVATE_KEY mancante"

  local owner amount_wei
  owner=$(cast wallet address --private-key "$OWNER_KEY")
  amount_wei=$(cast --to-wei 0.001 ether)

  echo "Invio $amount_wei wei a WETH.deposit() da $owner"
  cast send "$WETH_NATIVE" "deposit()" \
    --value "$amount_wei" \
    --private-key "$OWNER_KEY" \
    --rpc-url "$RPC_URL"
}

cmd_deposit_vault() {
  log "Deposito USDC nello SmartVault (OWNER)"
  require_cast
  require_rpc
  [[ -n "$OWNER_KEY" ]] || die "OWNER_PRIVATE_KEY / PRIVATE_KEY mancante"
  [[ -n "$VAULT" ]] || die "Imposta VAULT_ADDRESS (indirizzo clone da /vault o factory.vaultOf)"

  local owner asset
  owner=$(cast wallet address --private-key "$OWNER_KEY")

  if [[ -n "$FACTORY" ]]; then
    asset=$(cast call "$FACTORY" "asset()(address)" --rpc-url "$RPC_URL")
    echo "Factory asset (ERC-4626): $asset"
    if [[ "${asset,,}" != "${USDC_NATIVE,,}" ]] && [[ "${asset,,}" != "${USDC_NATIVE}" ]]; then
      echo ""
      echo "WARN: il vault non usa USDC nativo Sepolia!"
      echo "      Vault asset: $asset"
      echo "      Uniswap pool: $USDC_NATIVE"
      echo "      Redeploy factory con USDC nativo o il Keeper revertirà."
      read -r -p "Continuare comunque? [y/N] " ans
      [[ "$ans" == "y" || "$ans" == "Y" ]] || exit 1
    fi
    asset="$asset"
  else
    asset="$USDC_NATIVE"
    echo "VAULT_FACTORY_ADDRESS non impostato — assumo asset=$asset"
  fi

  local bal
  bal=$(cast call "$asset" "balanceOf(address)(uint256)" "$owner" --rpc-url "$RPC_URL")
  echo "Owner balance: $bal"
  if [[ "$bal" -lt "$DEPOSIT_AMOUNT" ]]; then
    die "Saldo insufficiente. Serve almeno $DEPOSIT_AMOUNT (min unit). Richiedi USDC dal faucet."
  fi

  echo "Approve vault spender..."
  cast send "$asset" "approve(address,uint256)(bool)" "$VAULT" "$DEPOSIT_AMOUNT" \
    --private-key "$OWNER_KEY" \
    --rpc-url "$RPC_URL"

  echo "deposit($DEPOSIT_AMOUNT, $owner)..."
  cast send "$VAULT" "deposit(uint256,address)(uint256)" "$DEPOSIT_AMOUNT" "$owner" \
    --private-key "$OWNER_KEY" \
    --rpc-url "$RPC_URL"

  local vault_bal
  vault_bal=$(cast call "$asset" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$RPC_URL")
  echo "Vault balance ($asset): $vault_bal"
  echo "OK: vault finanziato per test Keeper"
}

cmd_keeper_hint() {
  cat <<EOF

  Prossimi passi (Keeper test)
  ---------------------------
  1. apps/web — payloadJson con sizing per swap USDC→WETH:
     {
       "sizing": {
         "amountIn": "$DEPOSIT_AMOUNT",
         "tokenIn": "$USDC_NATIVE",
         "tokenOut": "$WETH_NATIVE",
         "fee": $FEE_TIER
       }
     }

  2. Chat → Conferma esecuzione → SUBMITTED

  3. cd apps/web && npm run keeper

  4. Verifica ExecutionLog CONFIRMED su Arbiscan Sepolia

  Explorer pool: https://sepolia.arbiscan.io/address/$KNOWN_POOL_USDC_WETH

EOF
}

cmd_all() {
  print_banner
  print_faucets
  cmd_check_pool || true
  cmd_balances || true
  cmd_keeper_hint
}

usage() {
  cat <<EOF
Uso: $0 <comando>

Comandi:
  check      Verifica factory.getPool + liquidity + SwapRouter (cast)
  forge      Stesso check via forge script CheckSepoliaPool.s.sol
  balances   Mostra ETH / USDC / WETH del wallet OWNER
  wrap       Wrap 0.001 ETH in WETH (test)
  deposit    approve + deposit USDC nel VAULT_ADDRESS (richiede .env)
  all        check + balances + istruzioni (default)
  help       Questo messaggio

EOF
}

main() {
  local cmd="${1:-all}"
  case "$cmd" in
    check)    print_banner; print_faucets; cmd_check_pool ;;
    forge)    print_banner; cmd_forge_check ;;
    balances) print_banner; cmd_balances ;;
    wrap)     cmd_wrap_eth ;;
    deposit)  print_banner; cmd_deposit_vault; cmd_keeper_hint ;;
    all)      cmd_all ;;
    help|-h)  usage ;;
    *)        usage; die "Comando sconosciuto: $cmd" ;;
  esac
}

main "$@"
