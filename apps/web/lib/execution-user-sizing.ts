import { isAddress, type Address } from "viem";

const USDC_DECIMALS = 6;
const USDC_SCALE = 1_000_000n;

export type ExecutionSizingPayload = {
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
  fee: number;
  source?: string;
  rebalanceSliceBps?: number;
  userConfirmed?: boolean;
  executionKind?: "uniswap_v3" | "primary_mint";
  marketRoutingMode?: string;
  symbol?: string;
  tokenOutSymbol?: string;
  primaryRouter?: string;
};

export type UserSizingInput = {
  amountIn: string;
  tokenIn?: string;
  tokenOut?: string;
  fee?: number;
};

/** Converte amountIn raw (6 decimali) in stringa USDC per l'input UI. */
export function rawUsdcToDisplay(amountInRaw: string): string {
  const trimmed = amountInRaw.trim();
  if (!/^\d+$/.test(trimmed)) return "0";
  const raw = BigInt(trimmed);
  if (raw <= 0n) return "0";
  const whole = raw / USDC_SCALE;
  const frac = raw % USDC_SCALE;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/** Parsing importo USDC inserito dall'utente → amountIn raw (BigInt). */
export function displayUsdcToRaw(display: string): bigint | null {
  const trimmed = display.trim().replace(",", ".");
  if (!trimmed || !/^\d+(\.\d{0,6})?$/.test(trimmed)) return null;
  const [wholePart, fracPart = ""] = trimmed.split(".");
  const whole = wholePart === "" ? 0n : BigInt(wholePart);
  const fracPadded = (fracPart + "000000").slice(0, USDC_DECIMALS);
  const frac = fracPadded === "" ? 0n : BigInt(fracPadded);
  const raw = whole * USDC_SCALE + frac;
  return raw > 0n ? raw : null;
}

export function isValidUsdcDisplay(display: string): boolean {
  return displayUsdcToRaw(display) != null;
}

function parseExistingSizing(
  payload: Record<string, unknown>,
): ExecutionSizingPayload | null {
  const sizing =
    payload.sizing && typeof payload.sizing === "object" && !Array.isArray(payload.sizing)
      ? (payload.sizing as Record<string, unknown>)
      : null;
  if (!sizing) return null;
  const amountIn =
    typeof sizing.amountIn === "string"
      ? sizing.amountIn
      : typeof sizing.amountIn === "number"
        ? String(Math.floor(sizing.amountIn))
        : null;
  const tokenIn =
    typeof sizing.tokenIn === "string" && isAddress(sizing.tokenIn)
      ? sizing.tokenIn
      : typeof sizing.assetIn === "string" && isAddress(sizing.assetIn)
        ? sizing.assetIn
        : null;
  const tokenOut =
    typeof sizing.tokenOut === "string" && isAddress(sizing.tokenOut)
      ? sizing.tokenOut
      : typeof sizing.assetOut === "string" && isAddress(sizing.assetOut)
        ? sizing.assetOut
        : null;
  const fee =
    typeof sizing.fee === "number" && sizing.fee > 0
      ? sizing.fee
      : typeof sizing.fee === "string" && /^\d+$/.test(sizing.fee)
        ? Number(sizing.fee)
        : null;
  if (!amountIn || !tokenIn || !tokenOut) return null;
  const feeVal =
    typeof sizing.fee === "number"
      ? sizing.fee
      : typeof sizing.fee === "string" && /^\d+$/.test(sizing.fee)
        ? Number(sizing.fee)
        : null;
  if (feeVal == null) return null;
  return {
    amountIn,
    tokenIn,
    tokenOut,
    fee: feeVal,
    source: typeof sizing.source === "string" ? sizing.source : undefined,
    rebalanceSliceBps:
      typeof sizing.rebalanceSliceBps === "number" ? sizing.rebalanceSliceBps : undefined,
    executionKind:
      sizing.executionKind === "primary_mint" || sizing.executionKind === "uniswap_v3"
        ? sizing.executionKind
        : undefined,
    marketRoutingMode:
      typeof sizing.marketRoutingMode === "string" ? sizing.marketRoutingMode : undefined,
    symbol: typeof sizing.symbol === "string" ? sizing.symbol : undefined,
    tokenOutSymbol:
      typeof sizing.tokenOutSymbol === "string" ? sizing.tokenOutSymbol : undefined,
    primaryRouter:
      typeof sizing.primaryRouter === "string" ? sizing.primaryRouter : undefined,
  };
}

/**
 * Applica la scelta utente su payloadJson.sizing prima di SUBMITTED.
 */
export function mergeUserSizingIntoPayload(
  payload: Record<string, unknown>,
  userSizing: UserSizingInput,
): { payload: Record<string, unknown> } | { error: string } {
  const existing = parseExistingSizing(payload);
  const amountRaw =
    parseAmountInRaw(userSizing.amountIn) ?? displayUsdcToRaw(userSizing.amountIn);
  if (amountRaw == null || amountRaw <= 0n) {
    return { error: "Importo USDC non valido (deve essere > 0)." };
  }

  const tokenIn =
    userSizing.tokenIn && isAddress(userSizing.tokenIn)
      ? userSizing.tokenIn
      : existing?.tokenIn;
  const tokenOut =
    userSizing.tokenOut && isAddress(userSizing.tokenOut)
      ? userSizing.tokenOut
      : existing?.tokenOut;
  const fee =
    userSizing.fee != null && userSizing.fee >= 0
      ? userSizing.fee
      : existing?.fee;

  if (!tokenIn || !tokenOut) {
    return {
      error:
        "tokenIn/tokenOut mancanti: servono nel payload della proposta o in userSizing.",
    };
  }
  const isPrimary = existing?.executionKind === "primary_mint";
  if (fee == null || fee < 0 || (!isPrimary && fee <= 0)) {
    return { error: "fee pool mancante o non valida." };
  }

  const sizing: ExecutionSizingPayload = {
    amountIn: amountRaw.toString(),
    tokenIn,
    tokenOut,
    fee,
    source: existing?.source ?? "user_confirmed",
    rebalanceSliceBps: existing?.rebalanceSliceBps,
    userConfirmed: true,
    executionKind: existing?.executionKind,
    marketRoutingMode: existing?.marketRoutingMode,
    symbol: existing?.symbol,
    tokenOutSymbol: existing?.tokenOutSymbol,
    primaryRouter: existing?.primaryRouter,
  };

  return {
    payload: {
      ...payload,
      sizing,
    },
  };
}

function parseAmountInRaw(value: string): bigint | null {
  const t = value.trim();
  if (!/^\d+$/.test(t)) return null;
  try {
    const n = BigInt(t);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

export function extractSizingFromPayload(
  payload: Record<string, unknown> | null | undefined,
): ExecutionSizingPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return parseExistingSizing(payload);
}
