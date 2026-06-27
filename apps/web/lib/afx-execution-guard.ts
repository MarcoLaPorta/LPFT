import type { MarketRoutingMode } from "./afx-market-routing";
import { isUsEquitySessionOpen, suggestMarketRoutingMode } from "./afx-market-routing";
import { estimateHftRoundTripCostBps, resolveFeeBps } from "../services/quant/trading-friction";

type ProposeMetrics = {
  sharpe?: number;
  maxDrawdown?: number;
};

export type ProposeExecutionGuardInput = {
  metrics?: ProposeMetrics;
  intentClass?: string;
  marketRoutingMode?: MarketRoutingMode;
  ticker?: string;
  /** Spread stimato per gamba (bps) — obbligatorio per HFT guardrail spread vs profit. */
  estimatedSpreadBps?: number;
  targetProfitBps?: number;
  /** Slippage totale stimato (bps). */
  slippageBps?: number;
  /** Fee maker istituzionale (bps). */
  makerFeeBps?: number;
  /** Fee taker istituzionale (bps). */
  takerFeeBps?: number;
  /** true = maker (limit); false = taker (market). */
  useLimitOrdersOnly?: boolean;
};

type DrawdownAction = "warn" | "reject" | "off";

export type ProposeExecutionGuardResult =
  | { ok: true; warning?: string }
  | { ok: false; reason: string };

const SLOW_ROUTING: MarketRoutingMode[] = ["PRIMARY_MINT_BURN", "PRIMARY_RFQ_ATOMIC"];

function resolveDrawdownAction(): DrawdownAction {
  const raw = process.env.AFX_MAX_DRAWDOWN_ACTION?.trim().toLowerCase();
  if (raw === "reject" || raw === "warn" || raw === "off") {
    return raw;
  }
  return "warn";
}

function resolveDrawdownThreshold(): number {
  const raw = Number(process.env.AFX_MAX_DRAWDOWN_THRESHOLD ?? "0.35");
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0.35;
  }
  return raw;
}

function validateHFTExecution(input: ProposeExecutionGuardInput): ProposeExecutionGuardResult {
  const routing =
    input.marketRoutingMode ??
    (input.ticker ? suggestMarketRoutingMode(input.ticker) : "SECONDARY_AMM");

  if (SLOW_ROUTING.includes(routing)) {
    const label =
      routing === "PRIMARY_MINT_BURN"
        ? "PRIMARY_MINT_BURN (mercato primario RTH)"
        : "PRIMARY_RFQ_ATOMIC (RFQ primario)";
    return {
      ok: false,
      reason: `HFT/scalping non consentito su ${label}. Usare SECONDARY_AMM (on-chain / DEX veloce).`,
    };
  }

  if (routing !== "SECONDARY_AMM") {
    return {
      ok: false,
      reason: `HIGH_FREQUENCY_SCALPING richiede marketRoutingMode SECONDARY_AMM (attuale: ${routing}).`,
    };
  }

  const spread = input.estimatedSpreadBps;
  const profit = input.targetProfitBps;
  const slippage = input.slippageBps;
  const fees = resolveFeeBps(input);
  const maker = input.useLimitOrdersOnly ?? true;
  if (
    typeof spread === "number" &&
    typeof profit === "number" &&
    typeof slippage === "number"
  ) {
    const roundTripCost = estimateHftRoundTripCostBps({
      useLimitOrdersOnly: maker,
      estimatedSpreadBps: spread,
      slippageBps: slippage,
      makerFeeBps: fees.makerFeeBps,
      takerFeeBps: fees.takerFeeBps,
    });
    const required = 1.5 * roundTripCost;
    if (profit <= required) {
      return {
        ok: false,
        reason:
          `Edge HFT negativo (${maker ? "maker" : "taker"}): targetProfitBps ${profit} ≤ ` +
          `1.5× costo round-trip ${required.toFixed(1)} bps (~${roundTripCost.toFixed(1)} bps).`,
      };
    }
  } else if (typeof spread === "number" && typeof profit === "number" && spread >= profit) {
    return {
      ok: false,
      reason: `Spread stimato ${spread} bps ≥ take-profit per tick ${profit} bps: edge negativo dopo costi.`,
    };
  }

  if (typeof spread === "number" && spread > 0 && profit == null) {
    return {
      ok: true,
      warning: `Spread stimato ${spread} bps: verificare targetProfitBps nella strategia HFT.`,
    };
  }

  if (isUsEquitySessionOpen() && input.ticker && !isCryptoTicker(input.ticker)) {
    return {
      ok: true,
      warning:
        "Equity US in sessione RTH: confermare che l'esecuzione HFT passi da SECONDARY_AMM on-chain, non da primario.",
    };
  }

  return { ok: true };
}

function isCryptoTicker(ticker: string): boolean {
  const t = ticker.toUpperCase();
  return (
    t.endsWith("-USD") ||
    ["BTC", "ETH", "SOL", "USDC", "USDT"].some((c) => t === c || t.startsWith(`${c}-`))
  );
}

function isGuardInput(v: ProposeMetrics | ProposeExecutionGuardInput): v is ProposeExecutionGuardInput {
  return (
    "intentClass" in v ||
    "marketRoutingMode" in v ||
    "estimatedSpreadBps" in v ||
    "targetProfitBps" in v ||
    "ticker" in v
  );
}

export function validateProposeExecution(
  metricsOrInput?: ProposeMetrics | ProposeExecutionGuardInput,
): ProposeExecutionGuardResult {
  const input: ProposeExecutionGuardInput =
    metricsOrInput != null && isGuardInput(metricsOrInput)
      ? metricsOrInput
      : { metrics: metricsOrInput as ProposeMetrics | undefined };

  if (input.intentClass === "HIGH_FREQUENCY_SCALPING") {
    const hftResult = validateHFTExecution(input);
    if (hftResult.ok === false) return hftResult;
    return hftResult.warning ? { ok: true, warning: hftResult.warning } : { ok: true };
  }

  const metrics = input.metrics ?? (metricsOrInput as ProposeMetrics | undefined);

  if (!metrics) {
    return { ok: true };
  }

  if (typeof metrics.sharpe === "number" && metrics.sharpe < -0.5) {
    return {
      ok: false,
      reason: `Sharpe ${metrics.sharpe.toFixed(2)} sotto soglia fiduciaria. Esecuzione bloccata.`,
    };
  }

  if (typeof metrics.maxDrawdown !== "number") {
    return { ok: true };
  }

  const threshold = resolveDrawdownThreshold();
  if (metrics.maxDrawdown <= threshold) {
    return { ok: true };
  }

  const pct = (metrics.maxDrawdown * 100).toFixed(1);
  const limitPct = (threshold * 100).toFixed(1);
  const action = resolveDrawdownAction();

  if (action === "reject") {
    return {
      ok: false,
      reason: `Max drawdown ${pct}% oltre soglia ${limitPct}%. Esecuzione bloccata.`,
    };
  }
  if (action === "warn") {
    return {
      ok: true,
      warning: `Max drawdown ${pct}% oltre soglia ${limitPct}%. Procedere con cautela.`,
    };
  }
  return { ok: true };
}
