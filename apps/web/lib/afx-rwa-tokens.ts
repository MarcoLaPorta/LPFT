import { isAddress, type Address } from "viem";
import { prisma } from "./prisma";
import { isCryptoTicker } from "./afx-market-routing";

/** Mapping ticker equity → token RWA testnet (env dopo deploy). */
const TICKER_TO_RWA_ENV: Record<string, string> = {
  QQQ: "AFX_RWA_MQQQ_ADDRESS",
  "QQQ-USD": "AFX_RWA_MQQQ_ADDRESS",
  GLD: "AFX_RWA_MGLD_ADDRESS",
  "GLD-USD": "AFX_RWA_MGLD_ADDRESS",
  SPY: "AFX_RWA_MQQQ_ADDRESS",
  AAPL: "AFX_RWA_MQQQ_ADDRESS",
  MSFT: "AFX_RWA_MQQQ_ADDRESS",
  NVDA: "AFX_RWA_MQQQ_ADDRESS",
};

export type RwaTokenRef = {
  tokenAddress: Address;
  symbol: string;
  underlyingTicker: string;
  decimals: number;
};

function envRwaAddress(key: string): Address | null {
  const v = process.env[key]?.trim() ?? process.env[`NEXT_PUBLIC_${key}`]?.trim();
  return v && isAddress(v) ? (v as Address) : null;
}

/** Risolve token RWA on-chain per ticker strategia (DB RwaToken → env fallback). */
export async function resolveRwaTokenForTicker(
  ticker: string,
  chainId: number,
): Promise<RwaTokenRef | null> {
  const t = ticker.toUpperCase().replace(/^\^/, "");
  if (isCryptoTicker(t)) return null;

  const row = await prisma.rwaToken.findFirst({
    where: {
      chainId,
      active: true,
      OR: [{ symbol: t }, { underlyingTicker: t }],
    },
    select: {
      tokenAddress: true,
      symbol: true,
      underlyingTicker: true,
      decimals: true,
    },
  });
  if (row?.tokenAddress && isAddress(row.tokenAddress)) {
    return {
      tokenAddress: row.tokenAddress as Address,
      symbol: row.symbol,
      underlyingTicker: row.underlyingTicker,
      decimals: row.decimals,
    };
  }

  const envKey = TICKER_TO_RWA_ENV[t] ?? TICKER_TO_RWA_ENV[t.split("-")[0] ?? ""];
  if (!envKey) return null;
  const addr = envRwaAddress(envKey);
  if (!addr) return null;

  return {
    tokenAddress: addr,
    symbol: envKey.includes("MGLD") ? "mGLD" : "mQQQ",
    underlyingTicker: t,
    decimals: 18,
  };
}

export function primaryRouterAddress(chainId: number): Address | null {
  const raw =
    process.env.AFX_RWA_PRIMARY_ADDRESS?.trim() ??
    process.env.NEXT_PUBLIC_AFX_RWA_PRIMARY_ADDRESS?.trim();
  if (raw && isAddress(raw)) return raw as Address;
  if (chainId === 421614 || chainId === 31337) {
    return null;
  }
  return null;
}

/** USDC 6 dec → RWA 18 dec, 1:1 nominale. */
export function quotePrimaryMintAmountOut(usdcAmountIn: bigint): bigint {
  if (usdcAmountIn <= 0n) return 0n;
  return usdcAmountIn * 1_000_000_000_000n;
}
