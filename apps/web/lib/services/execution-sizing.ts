import {
  createPublicClient,
  http,
  isAddress,
  type Address,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import type { MarketRoutingMode } from "./afx-market-routing";
import { isCryptoTicker } from "./afx-market-routing";
import { primaryRouterAddress, resolveRwaTokenForTicker } from "./afx-rwa-tokens";
import { erc20Abi } from "../web3/abis";
import { anvilLocal } from "../web3/chains";
import {
  ARBITRUM_SEPOLIA_USDC,
  ARBITRUM_SEPOLIA_WETH,
  UNISWAP_V3_FEE_TIER_3000,
} from "../web3/uniswap-v3";
import { prisma } from "../prisma";

function keeperRpcUrl(chainId: number): string {
  if (chainId === anvilLocal.id) {
    return (
      process.env.AFX_RPC_URL?.trim() ??
      process.env.NEXT_PUBLIC_RPC_LOCAL?.trim() ??
      "http://127.0.0.1:8545"
    );
  }
  if (chainId === arbitrumSepolia.id) {
    return (
      process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() ??
      process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC?.trim() ??
      process.env.AFX_RPC_URL?.trim() ??
      "https://sepolia-rollup.arbitrum.io/rpc"
    );
  }
  const generic = process.env.AFX_RPC_URL?.trim();
  if (generic) return generic;
  throw new Error(`RPC non configurato per chainId=${chainId}`);
}

const REFERENCE_NAV_USDC_RAW = 100_000n * 1_000_000n;
const REBALANCE_SLICE_BPS = 1_000n;
const MIN_TRADE_USDC_RAW = 1_000_000n;

export type ExecutionKind = "uniswap_v3" | "primary_mint";

export type ExecutionSizing = {
  amountIn: string;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  source: "vault_balance" | "strategy_rebalance" | "backtest_trades";
  rebalanceSliceBps: number;
  executionKind: ExecutionKind;
  marketRoutingMode: MarketRoutingMode;
  symbol: string;
  tokenOutSymbol: string;
  primaryRouter?: string;
};

export type ExecutionSizingJson = {
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  source: ExecutionSizing["source"];
  rebalanceSliceBps: number;
  executionKind: ExecutionKind;
  marketRoutingMode: MarketRoutingMode;
  symbol: string;
  tokenOutSymbol: string;
  primaryRouter?: string;
};

function envUsdc(chainId: number): Address | null {
  const raw =
    process.env.NEXT_PUBLIC_AFX_USDC_ADDRESS?.trim() ??
    process.env.AFX_USDC_ADDRESS?.trim();
  if (raw && isAddress(raw)) return raw;
  if (chainId === 421614) return ARBITRUM_SEPOLIA_USDC;
  return null;
}

function envWeth(chainId: number): Address | null {
  if (chainId === 421614) return ARBITRUM_SEPOLIA_WETH;
  return (
    process.env.AFX_WETH_ADDRESS?.trim() &&
    isAddress(process.env.AFX_WETH_ADDRESS.trim())
      ? (process.env.AFX_WETH_ADDRESS.trim() as Address)
      : null
  );
}

function chainFromEnv(): number {
  return Number(
    process.env.AFX_CHAIN_ID ?? process.env.NEXT_PUBLIC_AFX_CHAIN_ID ?? anvilLocal.id,
  );
}

async function readVaultUsdcBalance(
  userId: string,
  chainId: number,
  usdc: Address,
): Promise<bigint> {
  const vault = await prisma.smartVault.findFirst({
    where: { userId, chainId, status: "ACTIVE" },
    orderBy: { deployedAt: "desc" },
    select: { vaultAddress: true },
  });
  if (!vault?.vaultAddress || !isAddress(vault.vaultAddress)) return 0n;

  try {
    const rpcUrl = keeperRpcUrl(chainId);
    const chain =
      chainId === anvilLocal.id
        ? anvilLocal
        : chainId === arbitrumSepolia.id
          ? arbitrumSepolia
          : {
              id: chainId,
              name: "afx",
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: { default: { http: [rpcUrl] } },
            };
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    return await client.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [vault.vaultAddress as Address],
    });
  } catch {
    return 0n;
  }
}

function rebalanceSliceBpsFromStrategy(strategy: Record<string, unknown>): bigint {
  const wl =
    strategy.walletLogic && typeof strategy.walletLogic === "object"
      ? (strategy.walletLogic as Record<string, unknown>)
      : null;
  const freq = wl?.rebalanceFrequency;
  if (freq === "QUARTERLY") return 2_500n;
  if (freq === "MONTHLY") return 1_500n;
  return REBALANCE_SLICE_BPS;
}

function notionalFromBacktestTrades(strategy: Record<string, unknown>): bigint | null {
  const trades = strategy.trades;
  if (!Array.isArray(trades) || trades.length === 0) return null;
  let max = 0;
  for (const t of trades) {
    if (!t || typeof t !== "object") continue;
    const row = t as Record<string, unknown>;
    const n =
      typeof row.notional === "number" && Number.isFinite(row.notional)
        ? row.notional
        : typeof row.value === "number" && Number.isFinite(row.value)
          ? row.value
          : 0;
    if (n > max) max = n;
  }
  if (max <= 0) return null;
  return BigInt(Math.max(1, Math.floor(max * 1_000_000)));
}

function deriveAmountInFromStrategy(
  strategy: Record<string, unknown>,
  vaultBalance: bigint,
): { amountIn: bigint; source: ExecutionSizing["source"] } {
  const sliceBps = rebalanceSliceBpsFromStrategy(strategy);

  if (vaultBalance > 0n) {
    let slice = (vaultBalance * sliceBps) / 10_000n;
    if (slice < MIN_TRADE_USDC_RAW) slice = MIN_TRADE_USDC_RAW;
    if (slice > vaultBalance) slice = vaultBalance;
    return { amountIn: slice, source: "vault_balance" };
  }

  const fromTrades = notionalFromBacktestTrades(strategy);
  if (fromTrades != null && fromTrades > 0n) {
    return { amountIn: fromTrades, source: "backtest_trades" };
  }

  const slice = (REFERENCE_NAV_USDC_RAW * sliceBps) / 10_000n;
  const amountIn = slice < MIN_TRADE_USDC_RAW ? MIN_TRADE_USDC_RAW : slice;
  return { amountIn, source: "strategy_rebalance" };
}

function resolveSymbol(strategy: Record<string, unknown>, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim().toUpperCase();
  const s = strategy.symbol ?? strategy.ticker;
  if (typeof s === "string" && s.trim()) return s.trim().toUpperCase();
  return "SPY";
}

/**
 * Calcola sizing per proposeExecution / keeper.
 * SECONDARY_AMM (crypto): USDC → WETH via Uniswap.
 * PRIMARY_* (RWA): USDC → token sintetico via MockRwaPrimary.
 */
export async function computeExecutionSizing(args: {
  userId: string;
  strategyJSON: Record<string, unknown>;
  chainId?: number;
  marketRoutingMode?: string;
  symbol?: string;
}): Promise<ExecutionSizing> {
  const chainId = args.chainId ?? chainFromEnv();
  const usdc = envUsdc(chainId);
  if (!usdc) {
    throw new Error(
      "USDC non configurato: imposta NEXT_PUBLIC_AFX_USDC_ADDRESS (o usa chain 421614).",
    );
  }

  const symbol = resolveSymbol(args.strategyJSON, args.symbol);
  const routing = (args.marketRoutingMode ?? "SECONDARY_AMM") as MarketRoutingMode;
  const vaultBal = await readVaultUsdcBalance(args.userId, chainId, usdc);
  const { amountIn, source } = deriveAmountInFromStrategy(args.strategyJSON, vaultBal);
  const sliceBps = Number(rebalanceSliceBpsFromStrategy(args.strategyJSON));

  const usePrimary =
    routing === "PRIMARY_MINT_BURN" ||
    routing === "PRIMARY_RFQ_ATOMIC" ||
    (!isCryptoTicker(symbol) && routing !== "SECONDARY_AMM");

  if (usePrimary) {
    const rwa = await resolveRwaTokenForTicker(symbol, chainId);
    if (!rwa) {
      throw new Error(
        `Token RWA non configurato per ${symbol} su chain ${chainId}. ` +
          "Esegui deploy + npm run seed:rwa e imposta AFX_RWA_MQQQ_ADDRESS in .env.local.",
      );
    }
    const primary = primaryRouterAddress(chainId);
    if (!primary) {
      throw new Error(
        "MockRwaPrimary non configurato: imposta AFX_RWA_PRIMARY_ADDRESS (output deploy).",
      );
    }
    return {
      amountIn: amountIn.toString(),
      tokenIn: usdc,
      tokenOut: rwa.tokenAddress,
      fee: 0,
      source,
      rebalanceSliceBps: sliceBps,
      executionKind: "primary_mint",
      marketRoutingMode: routing,
      symbol,
      tokenOutSymbol: rwa.symbol,
      primaryRouter: primary,
    };
  }

  const weth = envWeth(chainId);
  if (!weth) {
    throw new Error("tokenOut WETH non configurato per questa chain.");
  }

  return {
    amountIn: amountIn.toString(),
    tokenIn: usdc,
    tokenOut: weth,
    fee: UNISWAP_V3_FEE_TIER_3000,
    source,
    rebalanceSliceBps: sliceBps,
    executionKind: "uniswap_v3",
    marketRoutingMode: "SECONDARY_AMM",
    symbol,
    tokenOutSymbol: "WETH",
  };
}

export function executionSizingToJson(s: ExecutionSizing): ExecutionSizingJson {
  return {
    amountIn: s.amountIn,
    tokenIn: s.tokenIn,
    tokenOut: s.tokenOut,
    fee: s.fee,
    source: s.source,
    rebalanceSliceBps: s.rebalanceSliceBps,
    executionKind: s.executionKind,
    marketRoutingMode: s.marketRoutingMode,
    symbol: s.symbol,
    tokenOutSymbol: s.tokenOutSymbol,
    primaryRouter: s.primaryRouter,
  };
}
