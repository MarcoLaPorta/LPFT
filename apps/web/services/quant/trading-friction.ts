/**
 * Costi di transazione (trading friction) — fee istituzionale maker/taker in bps + slippage sul fill.
 */

export type AssetClass = "crypto" | "etf" | "equity";

/** Fee istituzionale unificata (basis points sul notional). */
export type FeeBps = { makerFeeBps: number; takerFeeBps: number };

export const DEFAULT_MAKER_FEE_BPS = 0;
export const DEFAULT_TAKER_FEE_BPS = 5;

const DEFAULT_SLIPPAGE_BPS: Record<AssetClass, number> = {
  crypto: 12,
  etf: 2,
  equity: 4,
};

function isCryptoTicker(symbol: string): boolean {
  const u = symbol.toUpperCase();
  return (
    u.endsWith("-USD") ||
    u.endsWith("/USD") ||
    ["BTC", "ETH", "SOL", "USDC", "USDT"].some((c) => u === c || u.startsWith(`${c}-`))
  );
}

function isEtfTicker(symbol: string): boolean {
  const u = symbol.toUpperCase();
  return [
    "SPY",
    "QQQ",
    "IWM",
    "DIA",
    "VTI",
    "VOO",
    "GLD",
    "TLT",
    "EFA",
    "EEM",
  ].includes(u);
}

export function classifyAssetClass(symbol: string): AssetClass {
  if (isCryptoTicker(symbol)) return "crypto";
  if (isEtfTicker(symbol)) return "etf";
  return "equity";
}

export function defaultSlippageBpsForSymbol(symbol: string): number {
  return DEFAULT_SLIPPAGE_BPS[classifyAssetClass(symbol)];
}

export function resolveSlippageBpsForSymbol(symbol: string, configuredBps?: number): number {
  return configuredBps ?? defaultSlippageBpsForSymbol(symbol);
}

/** Converte basis points in rate decimale (5 bps → 0.0005). */
export function bpsToRate(bps: number): number {
  const b = Number(bps);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return b / 10_000;
}

/** Converte rate decimale in basis points (0.0005 → 5). */
export function rateToBps(rate: number): number {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return 0;
  return r * 10_000;
}

/** @deprecated Usare rateToBps */
export function feeBpsFromRate(transactionFeeRate: number): number {
  return rateToBps(transactionFeeRate);
}

export type LegacyFeeInput = {
  makerFeeBps?: number;
  takerFeeBps?: number;
  /** @deprecated Legacy rate (0.003 = 30 bps) */
  makerFeeRate?: number;
  /** @deprecated Legacy rate */
  takerFeeRate?: number;
  /** @deprecated Legacy flat fee — mappato a takerFeeBps */
  transactionFeeRate?: number;
};

/**
 * Risolve fee istituzionale da riskManagement con fallback legacy (rate → bps).
 */
export function resolveFeeBps(risk: LegacyFeeInput): FeeBps {
  const makerFeeBps =
    risk.makerFeeBps ??
    (risk.makerFeeRate != null ? rateToBps(risk.makerFeeRate) : DEFAULT_MAKER_FEE_BPS);
  const takerFeeBps =
    risk.takerFeeBps ??
    (risk.takerFeeRate != null
      ? rateToBps(risk.takerFeeRate)
      : risk.transactionFeeRate != null
        ? rateToBps(risk.transactionFeeRate)
        : DEFAULT_TAKER_FEE_BPS);
  return { makerFeeBps, takerFeeBps };
}

/** @deprecated Usare resolveFeeBps */
export function resolveHftFeeRates(risk: LegacyFeeInput): FeeBps {
  return resolveFeeBps(risk);
}

/**
 * Stima costo round-trip HFT (bps) per edge guard.
 * Maker: entry maker + TP exit maker → solo fee maker su entrambe le gambe.
 * Taker: spread + slippage + fee taker su entrambe le gambe.
 */
export function estimateHftRoundTripCostBps(input: {
  useLimitOrdersOnly: boolean;
  estimatedSpreadBps: number;
  slippageBps: number;
  makerFeeBps: number;
  takerFeeBps: number;
}): number {
  const makerFeeBps = Math.max(0, input.makerFeeBps);
  const takerFeeBps = Math.max(0, input.takerFeeBps);
  if (input.useLimitOrdersOnly) {
    return 2 * makerFeeBps;
  }
  const spread = Math.max(0, input.estimatedSpreadBps);
  const slip = Math.max(0, input.slippageBps);
  return spread + 2 * slip + 2 * takerFeeBps;
}

/**
 * Vincolo “sopravvivenza” HFT: targetProfitBps deve coprire costi round-trip (con margine).
 */
export function requiredTargetProfitBps(input: {
  estimatedSpreadBps: number;
  slippageBps: number;
  makerFeeBps?: number;
  takerFeeBps?: number;
  useLimitOrdersOnly?: boolean;
  multiplier?: number;
}): number {
  const m = input.multiplier ?? 1.5;
  const fees = resolveFeeBps(input);
  const cost = estimateHftRoundTripCostBps({
    useLimitOrdersOnly: input.useLimitOrdersOnly ?? false,
    estimatedSpreadBps: input.estimatedSpreadBps,
    slippageBps: input.slippageBps,
    makerFeeBps: fees.makerFeeBps,
    takerFeeBps: fees.takerFeeBps,
  });
  return m * cost;
}

/** Fill BUY taker aggressivo: attraversa lo spread (ask) + slippage + impatto. */
export function hftTakerBuyFill(
  book: { asks: { price: number; size: number }[] },
  slippageBps: number,
  orderSize = 1,
): number {
  const ask = book.asks[0];
  if (!ask) return 0;
  return buyFillWithImpact(ask.price, slippageBps, {
    orderSize,
    l2Liquidity: ask.size,
  });
}

/** Fill SELL taker aggressivo: attraversa lo spread (bid) + slippage + impatto. */
export function hftTakerSellFill(
  book: { bids: { price: number; size: number }[] },
  slippageBps: number,
  orderSize = 1,
): number {
  const bid = book.bids[0];
  if (!bid) return 0;
  return sellFillWithImpact(bid.price, slippageBps, {
    orderSize,
    l2Liquidity: bid.size,
  });
}

/** Fill maker passivo: prezzo limite al bid (buy) o ask (sell), senza slippage. */
export function hftMakerLimitPrice(
  side: "buy" | "sell",
  book: { bids: { price: number }[]; asks: { price: number }[] },
): number {
  if (side === "buy") return book.bids[0]?.price ?? 0;
  return book.asks[0]?.price ?? 0;
}

/** Applica fee sul prezzo di fill (buy peggiora, sell peggiora). */
export function applyHftFeeToFill(
  fillPrice: number,
  leg: "buy" | "sell",
  fees: FeeBps,
  isMaker: boolean,
): number {
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) return fillPrice;
  const bps = Math.max(0, isMaker ? fees.makerFeeBps : fees.takerFeeBps);
  const rate = bpsToRate(bps);
  if (rate <= 0) return fillPrice;
  return leg === "buy" ? fillPrice * (1 + rate) : fillPrice * (1 - rate);
}

/**
 * Prezzo limit maker per take-profit passivo.
 * Long: sell limit; short: buy limit — calibrato su targetProfitBps netto post-fee maker.
 */
export function makerTakeProfitLimitPrice(
  positionSide: "long" | "short",
  entryFillPrice: number,
  targetProfitBps: number,
  makerFeeBps: number,
): number {
  if (!Number.isFinite(entryFillPrice) || entryFillPrice <= 0) return 0;
  const target = targetProfitBps / 10_000;
  const fee = bpsToRate(makerFeeBps);
  if (positionSide === "long") {
    const targetExitFill = entryFillPrice * (1 + target);
    return fee > 0 ? targetExitFill / (1 - fee) : targetExitFill;
  }
  const targetExitFill = entryFillPrice * (1 - target);
  return fee > 0 ? targetExitFill / (1 + fee) : targetExitFill;
}

/** Fee in valuta base = notional × (feeBps / 10_000). Daily usa takerFeeBps (ordini a mercato). */
export function feeOnNotional(notional: number, feeBps: number): number {
  if (feeBps <= 0 || notional <= 0 || !Number.isFinite(notional)) return 0;
  return notional * bpsToRate(feeBps);
}

/** Prezzo di fill BUY (peggiorativo): close × (1 + bps/10_000). */
export function buyFillPrice(close: number, slippageBps: number): number {
  if (!Number.isFinite(close) || close <= 0) return close;
  const bps = Math.max(0, slippageBps);
  return close * (1 + bps / 10_000);
}

/** Prezzo di fill SELL (peggiorativo): close × (1 - bps/10_000). */
export function sellFillPrice(close: number, slippageBps: number): number {
  if (!Number.isFinite(close) || close <= 0) return close;
  const bps = Math.max(0, slippageBps);
  return close * (1 - bps / 10_000);
}

/**
 * Notional massimo acquistabile con cash disponibile (fee sul notional; slippage già nel fill price).
 */
export function maxAffordableBuyNotional(cash: number, feeBps: number): number {
  if (cash <= 0 || !Number.isFinite(cash)) return 0;
  const feeMult = 1 + bpsToRate(Math.max(0, feeBps));
  return cash / feeMult;
}

export type AlmgrenChrissInput = {
  /** Notional o shares dell'ordine. */
  orderSize: number;
  /** Liquidità L2 disponibile al livello (shares/notional). */
  l2Liquidity: number;
  /** Scala impatto (default 1). */
  impactScale?: number;
  /** Coefficiente impatto permanente (default 50 bps a √(order/liq)=1). */
  baseImpactBps?: number;
};

/**
 * Slippage Almgren–Chriss ∝ √(orderSize / L2 liquidity) in bps.
 * Usato dal percorso HFT per stime di impatto su fill aggressivi.
 */
export function almgrenChrissImpactBps(input: AlmgrenChrissInput): number {
  const order = Math.max(0, input.orderSize);
  const liq = Math.max(1e-9, input.l2Liquidity);
  const scale = input.impactScale ?? 1;
  const base = input.baseImpactBps ?? 50;
  const ratio = Math.sqrt(order / liq);
  return base * ratio * scale;
}

/** Fill BUY con slippage fisso (bps) + impatto Almgren–Chriss. */
export function buyFillWithImpact(
  midPrice: number,
  slippageBps: number,
  impact: AlmgrenChrissInput,
): number {
  const totalBps = slippageBps + almgrenChrissImpactBps(impact);
  return buyFillPrice(midPrice, totalBps);
}

/** Fill SELL con slippage fisso (bps) + impatto Almgren–Chriss. */
export function sellFillWithImpact(
  midPrice: number,
  slippageBps: number,
  impact: AlmgrenChrissInput,
): number {
  const totalBps = slippageBps + almgrenChrissImpactBps(impact);
  return sellFillPrice(midPrice, totalBps);
}
