import { z } from "zod";
import type { BuildQuantitativeStrategyInput } from "./afx-quant-strategy-schema";
import { buildQuantitativeStrategySchema } from "./afx-quant-strategy-schema";

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

const ROOT_STRATEGY_KEYS = [
  "intentClass",
  "intent_class",
  "intentSummary",
  "intent_summary",
  "universe",
  "hftLogic",
  "hft_logic",
  "riskManagement",
  "risk_management",
  "risk",
  "backtest",
  "walletLogic",
  "wallet_logic",
  "marketRoutingMode",
  "market_routing_mode",
] as const;

/**
 * PARACADUTE ESTREMO — la correzione primaria è lo schema Zod `.strict()` + prompt tool.
 * Usato solo se l'LLM annida comunque il payload dentro algoLogic.
 * Se algoLogic contiene intentClass/hftLogic/universe e root no → hoist a root.
 */
export function unwrapMisnestedStrategyPayload(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const nested = raw.algoLogic ?? raw.algo_logic;
  if (!isRecord(nested)) return raw;

  const rootHasIntent =
    raw.intentClass != null ||
    raw.intent_class != null ||
    raw.intentSummary != null ||
    raw.intent_summary != null;
  const nestedHasStrategyShell =
    nested.intentClass != null ||
    nested.intent_class != null ||
    nested.intentSummary != null ||
    nested.intent_summary != null ||
    nested.hftLogic != null ||
    nested.hft_logic != null ||
    isRecord(nested.universe);

  if (rootHasIntent || !nestedHasStrategyShell) return raw;

  const algoSignal = nested.signal ?? nested.entryLogic;
  const algoOnly: Record<string, unknown> = {};
  if (algoSignal != null) algoOnly.signal = algoSignal;
  for (const k of ["sma", "rsi", "zScore", "z_score", "asymmetricTrendMomentum", "asymmetric_trend_momentum"] as const) {
    if (nested[k] != null) algoOnly[k] = nested[k];
  }

  const hoisted: Record<string, unknown> = { ...raw };
  for (const key of ROOT_STRATEGY_KEYS) {
    if (nested[key] != null && hoisted[key] == null) hoisted[key] = nested[key];
  }
  if (Object.keys(algoOnly).length > 0) {
    hoisted.algoLogic = algoOnly;
  } else {
    delete hoisted.algoLogic;
    delete hoisted.algo_logic;
  }
  return hoisted;
}

function legacyRateToBps(rate: unknown): number | undefined {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return undefined;
  return rate * 10_000;
}

function normalizeRiskBlock(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const makerFeeBps =
    typeof raw.makerFeeBps === "number"
      ? raw.makerFeeBps
      : typeof raw.maker_fee_bps === "number"
        ? raw.maker_fee_bps
        : legacyRateToBps(raw.makerFeeRate ?? raw.maker_fee_rate) ?? 0;
  const takerFeeBps =
    typeof raw.takerFeeBps === "number"
      ? raw.takerFeeBps
      : typeof raw.taker_fee_bps === "number"
        ? raw.taker_fee_bps
        : legacyRateToBps(
            raw.takerFeeRate ??
              raw.taker_fee_rate ??
              raw.transactionFeeRate ??
              raw.transaction_fee_rate ??
              raw.feeRate,
          ) ?? 5;
  return {
    maxDrawdownLimit:
      raw.maxDrawdownLimit ?? raw.max_drawdown_limit ?? raw.maxDrawdown ?? raw.max_drawdown,
    stopLossPercentage:
      raw.stopLossPercentage ?? raw.stop_loss_percentage ?? raw.stopLoss ?? raw.stop_loss,
    trailingStop: raw.trailingStop ?? raw.trailing_stop ?? false,
    liquidateToBaseOnMaxDrawdown:
      raw.liquidateToBaseOnMaxDrawdown ??
      raw.liquidate_to_base_on_max_drawdown ??
      true,
    makerFeeBps,
    takerFeeBps,
    slippageBps: raw.slippageBps ?? raw.slippage_bps ?? 0,
    fractionalKelly: raw.fractionalKelly ?? raw.fractional_kelly,
    enableKellyCap: raw.enableKellyCap ?? raw.enable_kelly_cap,
  };
}

function normalizeSignal(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const u = raw.toUpperCase().replace(/\s+/g, "_");
  if (u.includes("MACRO") && u.includes("REGIME")) return "MACRO_REGIME_BREAKOUT";
  if (u.includes("ASYMMETRIC")) return "ASYMMETRIC_TREND_MOMENTUM";
  if (u.includes("DUAL") && u.includes("MOMENTUM")) return "DUAL_MOMENTUM";
  return u;
}

/**
 * Normalizza payload LLM (snake_case, alias segnali) prima della validazione Zod.
 */
export function normalizeQuantStrategyPayload(raw: unknown): unknown {
  raw = unwrapMisnestedStrategyPayload(raw);
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };

  if (isRecord(raw.universe)) {
    const assets = (raw.universe.assets ?? raw.universe.symbols) as string[];
    out.universe = {
      assets,
      baseCurrency: (raw.universe.baseCurrency ?? raw.universe.base_currency ?? "USDC") as "USDC",
    };
  }

  const intentHint =
    typeof raw.intentClass === "string"
      ? raw.intentClass.toUpperCase()
      : typeof raw.intent_class === "string"
        ? raw.intent_class.toUpperCase()
        : "";
  const isHft =
    isRecord(raw.hftLogic) ||
    isRecord(raw.hft_logic) ||
    (intentHint.includes("HIGH") && intentHint.includes("FREQ")) ||
    intentHint.includes("HFT") ||
    intentHint.includes("SCALP");

  out.riskManagement = normalizeRiskBlock(raw.riskManagement ?? raw.risk_management ?? raw.risk);

  if (isRecord(raw.algoLogic)) {
    const atm =
      raw.algoLogic.asymmetricTrendMomentum ?? raw.algoLogic.asymmetric_trend_momentum;
    const algo: Record<string, unknown> = {
      signal: normalizeSignal(raw.algoLogic.signal ?? raw.algoLogic.entryLogic),
    };
    if (raw.algoLogic.sma != null) algo.sma = raw.algoLogic.sma;
    if (raw.algoLogic.rsi != null) algo.rsi = raw.algoLogic.rsi;
    if (raw.algoLogic.zScore != null) algo.zScore = raw.algoLogic.zScore;
    if (raw.algoLogic.z_score != null) algo.zScore = raw.algoLogic.z_score;
    if (isRecord(atm)) {
      algo.asymmetricTrendMomentum = {
        lookbackPeriodDays: atm.lookbackPeriodDays ?? atm.lookback_period_days ?? 90,
        equitySmaPeriod: atm.equitySmaPeriod ?? atm.equity_sma_period ?? 100,
        cryptoEmaPeriod: atm.cryptoEmaPeriod ?? atm.crypto_ema_period ?? 50,
        equityTicker: atm.equityTicker ?? atm.equity_ticker ?? "QQQ",
        cryptoTicker: atm.cryptoTicker ?? atm.crypto_ticker ?? "BTC-USD",
        safeHavenTicker: atm.safeHavenTicker ?? atm.safe_haven_ticker ?? "GLD",
      };
    } else if (atm != null) {
      algo.asymmetricTrendMomentum = atm;
    }
    out.algoLogic = algo;
  } else if (isRecord(raw.entryLogic)) {
    out.algoLogic = {
      signal: normalizeSignal(raw.entryLogic.indicator ?? raw.entryLogic.signal),
      sma: raw.entryLogic.sma,
      rsi: raw.entryLogic.rsi,
      zScore: raw.entryLogic.zScore ?? raw.entryLogic.z_score,
    };
  }

  if (isRecord(raw.walletLogic)) {
    out.walletLogic = {
      ...raw.walletLogic,
      rebalanceFrequency:
        raw.walletLogic.rebalanceFrequency ?? raw.walletLogic.rebalance_frequency,
    };
  }

  if (isRecord(raw.backtest)) {
    const bt: Record<string, unknown> = {
      primaryTicker:
        raw.backtest.primaryTicker ?? raw.backtest.primary_ticker ?? raw.backtest.ticker,
      benchmark: raw.backtest.benchmark ?? "^GSPC",
    };
    const tf = raw.backtest.timeframe;
    if (!isHft && tf != null) bt.timeframe = tf;
    out.backtest = bt;
  } else if (isHft) {
    const uni = (out.universe ?? raw.universe) as Record<string, unknown> | undefined;
    const assets = Array.isArray(uni?.assets) ? uni.assets : [];
    const primary =
      typeof assets[0] === "string"
        ? assets[0]
        : typeof raw.primaryTicker === "string"
          ? raw.primaryTicker
          : "ETH-USD";
    out.backtest = { primaryTicker: primary, benchmark: "^GSPC" };
  }

  const hft = raw.hftLogic ?? raw.hft_logic;
  if (isRecord(hft)) {
    out.hftLogic = {
      maxLatencyMs: hft.maxLatencyMs ?? hft.max_latency_ms ?? 250,
      orderBookImbalanceTrigger:
        hft.orderBookImbalanceTrigger ?? hft.order_book_imbalance_trigger ?? 0.62,
      microStopLossBps: hft.microStopLossBps ?? hft.micro_stop_loss_bps ?? 25,
      executionTimeoutSeconds:
        hft.executionTimeoutSeconds ?? hft.execution_timeout_seconds ?? 120,
      targetProfitBps: hft.targetProfitBps ?? hft.target_profit_bps ?? 15,
      estimatedSpreadBps: hft.estimatedSpreadBps ?? hft.estimated_spread_bps ?? 8,
      useLimitOrdersOnly:
        typeof hft.useLimitOrdersOnly === "boolean"
          ? hft.useLimitOrdersOnly
          : typeof hft.use_limit_orders_only === "boolean"
            ? hft.use_limit_orders_only
            : true,
      replayLookbackDays: hft.replayLookbackDays ?? hft.replay_lookback_days ?? 30,
      replayMaxSessions: hft.replayMaxSessions ?? hft.replay_max_sessions ?? 30,
    };
  }

  if (typeof raw.intentClass === "string") {
    const ic = raw.intentClass.toUpperCase().replace(/\s+/g, "_");
    if (ic.includes("HIGH") && ic.includes("FREQ")) {
      out.intentClass = "HIGH_FREQUENCY_SCALPING";
    } else if (ic.includes("SCALP")) {
      out.intentClass = "HIGH_FREQUENCY_SCALPING";
    } else if (ic.includes("HFT")) {
      out.intentClass = "HIGH_FREQUENCY_SCALPING";
    }
  }

  for (const legacy of [
    "risk_management",
    "risk",
    "hft_logic",
    "wallet_logic",
    "intent_class",
    "intent_summary",
    "market_routing_mode",
    "algo_logic",
    "entryLogic",
  ] as const) {
    delete out[legacy];
  }

  return out;
}

export function parseQuantStrategyPayload(
  raw: unknown,
):
  | { ok: true; data: BuildQuantitativeStrategyInput }
  | { ok: false; errors: string[] } {
  const normalized = normalizeQuantStrategyPayload(raw);
  const parsed = buildQuantitativeStrategySchema.safeParse(normalized);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "root"}: ${i.message}`),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Schema tool chat: normalizza payload LLM prima della validazione Zod strict. */
export const buildQuantitativeStrategyToolSchema = z.preprocess(
  (raw) => normalizeQuantStrategyPayload(raw),
  buildQuantitativeStrategySchema,
);
