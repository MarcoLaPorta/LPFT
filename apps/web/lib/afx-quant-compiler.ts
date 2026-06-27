import type { BuildQuantitativeStrategyInput } from "./afx-quant-strategy-schema";
import type { StrategySpec } from "../services/quant/backtest";
import type { HFTStrategyConfig } from "../services/quant/hft-engine";
import { parseQuantStrategyPayload } from "./afx-payload-normalize";
import { compileToEventDrivenConfig } from "../services/quant/strategy-adapter";
import {
  requiredTargetProfitBps,
  resolveFeeBps,
  resolveSlippageBpsForSymbol,
} from "../services/quant/trading-friction";
export { compileToEventDrivenConfig };
export { parseQuantStrategyPayload } from "./afx-payload-normalize";
export type { HFTStrategyConfig };

const CRYPTO_RE = /^(BTC|ETH|SOL|USDC|USDT|DAI)(-USD)?$/i;

function isCryptoSymbol(sym: string): boolean {
  const t = sym.toUpperCase().replace(/^\^/, "");
  return CRYPTO_RE.test(t) || t.endsWith("-USD");
}

/** Cappe fiduciarie su max drawdown (frazione). */
export function enforceRiskCaps(input: BuildQuantitativeStrategyInput): BuildQuantitativeStrategyInput {
  const assets = input.universe.assets.map((a) => a.toUpperCase());
  const hasCrypto = assets.some(isCryptoSymbol);
  const isRwaWallet = input.intentClass === "WALLET_MANAGEMENT";
  const cap = hasCrypto ? 0.2 : isRwaWallet ? 0.1 : 0.15;
  const md = Math.min(input.riskManagement.maxDrawdownLimit, cap);
  return {
    ...input,
    riskManagement: {
      ...input.riskManagement,
      maxDrawdownLimit: md,
      liquidateToBaseOnMaxDrawdown: true,
    },
  };
}

export function validateQuantStrategyInput(
  raw: BuildQuantitativeStrategyInput | unknown,
): { ok: true; data: BuildQuantitativeStrategyInput } | { ok: false; errors: string[] } {
  // Sempre parse+normalize via Zod per applicare default (fee/slippage) e vincoli refine.
  const parsed = parseQuantStrategyPayload(raw);
  if (!parsed.ok) return parsed;

  const errors: string[] = [];
  let data = enforceRiskCaps(parsed.data);

  if (
    data.intentClass === "ALGORITHMIC_TRADING" &&
    data.algoLogic?.signal === "ASYMMETRIC_TREND_MOMENTUM"
  ) {
    const p = data.algoLogic.asymmetricTrendMomentum;
    const required = [
      p?.equityTicker ?? "QQQ",
      p?.cryptoTicker ?? "BTC-USD",
      p?.safeHavenTicker ?? "GLD",
    ].map((t) => t.toUpperCase());
    const assets = data.universe.assets.map((a) => a.toUpperCase());
    for (const t of required) {
      if (!assets.includes(t)) assets.push(t);
    }
    data = { ...data, universe: { ...data.universe, assets } };
  }

  if (data.intentClass === "WALLET_MANAGEMENT") {
    if (!data.walletLogic) errors.push("walletLogic obbligatorio per WALLET_MANAGEMENT");
    if (data.algoLogic?.signal && data.algoLogic.signal !== "MACRO_ALLOCATION") {
      errors.push("WALLET_MANAGEMENT: usare MACRO_ALLOCATION, non indicatori intraday");
    }
  }

  if (data.intentClass === "HIGH_FREQUENCY_SCALPING") {
    if (!data.hftLogic) errors.push("hftLogic obbligatorio per HIGH_FREQUENCY_SCALPING");
    if (data.hftLogic) {
      const spread = data.hftLogic.estimatedSpreadBps;
      const slippage = resolveSlippageBpsForSymbol(
        data.backtest.primaryTicker,
        data.riskManagement.slippageBps,
      );
      const fees = resolveFeeBps(data.riskManagement);
      const required = requiredTargetProfitBps({
        estimatedSpreadBps: spread,
        slippageBps: slippage,
        makerFeeBps: fees.makerFeeBps,
        takerFeeBps: fees.takerFeeBps,
        useLimitOrdersOnly: data.hftLogic.useLimitOrdersOnly,
        multiplier: 1.5,
      });
      const target = data.hftLogic.targetProfitBps;
      if (typeof target === "number" && target <= required) {
        const mode = data.hftLogic.useLimitOrdersOnly ? "maker" : "taker";
        errors.push(
          `HFT edge negativo (${mode}): targetProfitBps ${target} ≤ ${required.toFixed(1)} bps (1.5× costo round-trip). Aumenta targetProfitBps o riduci costi.`,
        );
      }
    }
    data = {
      ...data,
      marketRoutingMode: "SECONDARY_AMM",
    };
  }

  if (data.intentClass === "ALGORITHMIC_TRADING") {
    if (!data.algoLogic) errors.push("algoLogic obbligatorio per ALGORITHMIC_TRADING");
    const sig = data.algoLogic?.signal;
    if (sig === "SMA_CROSSOVER" && !data.algoLogic?.sma) {
      errors.push("algoLogic.sma obbligatorio per SMA_CROSSOVER");
    }
    if (sig === "RSI" && !data.algoLogic?.rsi) {
      errors.push("algoLogic.rsi obbligatorio per RSI");
    }
    if (sig === "Z_SCORE" && !data.algoLogic?.zScore) {
      errors.push("algoLogic.zScore obbligatorio per Z_SCORE");
    }
    if (sig === "DUAL_MOMENTUM" && data.universe.assets.length < 2) {
      errors.push("DUAL_MOMENTUM: universe.assets deve contenere almeno 2 ticker");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data };
}

/** Traduce intent HFT in configurazione rigida per HFTExecutionEngine. */
export function compileToHFTConfig(input: BuildQuantitativeStrategyInput): HFTStrategyConfig {
  if (input.intentClass !== "HIGH_FREQUENCY_SCALPING" || !input.hftLogic) {
    throw new Error("compileToHFTConfig richiede intentClass HIGH_FREQUENCY_SCALPING e hftLogic");
  }
  const hft = input.hftLogic;
  const sym = input.backtest.primaryTicker.toUpperCase();
  const slippage = resolveSlippageBpsForSymbol(sym, input.riskManagement.slippageBps);
  const fees = resolveFeeBps(input.riskManagement);
  return {
    primaryTicker: sym,
    benchmark: (input.backtest.benchmark ?? "^GSPC").toUpperCase(),
    universe: input.universe.assets.map((a) => a.toUpperCase()),
    maxLatencyMs: Math.max(hft.maxLatencyMs, 150),
    orderBookImbalanceTrigger: hft.orderBookImbalanceTrigger,
    microStopLossBps: hft.microStopLossBps,
    executionTimeoutSeconds: hft.executionTimeoutSeconds,
    targetProfitBps: hft.targetProfitBps,
    estimatedSpreadBps: hft.estimatedSpreadBps,
    useLimitOrdersOnly: hft.useLimitOrdersOnly,
    slippageBps: slippage,
    makerFeeBps: fees.makerFeeBps,
    takerFeeBps: fees.takerFeeBps,
  };
}

export function isHFTStrategy(input: BuildQuantitativeStrategyInput): boolean {
  return input.intentClass === "HIGH_FREQUENCY_SCALPING";
}

/** Mappa il JSON quantitativo sul motore di simulazione OHLCV. */
export function compileToEngineSpec(input: BuildQuantitativeStrategyInput): StrategySpec {
  if (input.intentClass === "HIGH_FREQUENCY_SCALPING") {
    throw new Error("compileToEngineSpec non supporta HIGH_FREQUENCY_SCALPING; usare compileToHFTConfig");
  }
  const risk = input.riskManagement;

  if (input.intentClass === "WALLET_MANAGEMENT") {
    const reentry =
      input.walletLogic?.rebalanceFrequency === "QUARTERLY" ? 63 : 21;
    return {
      kind: "drawdown_to_stable",
      maxDrawdownFrac: risk.maxDrawdownLimit,
      reentrySmaDays: reentry,
      stopLossFrac: risk.stopLossPercentage,
      trailingStop: risk.trailingStop,
      circuitBreakerToStable: risk.liquidateToBaseOnMaxDrawdown,
      sourceSignal: "MACRO_ALLOCATION",
    };
  }

  const declared = input.algoLogic?.signal;
  const sig = declared ?? "SMA_CROSSOVER";
  if (sig === "MACRO_REGIME_BREAKOUT" || sig === "MACRO_ALLOCATION") {
    const reentry =
      input.walletLogic?.rebalanceFrequency === "QUARTERLY" ? 63 : 21;
    return {
      kind: "drawdown_to_stable",
      maxDrawdownFrac: risk.maxDrawdownLimit,
      reentrySmaDays: reentry,
      stopLossFrac: risk.stopLossPercentage,
      trailingStop: risk.trailingStop,
      circuitBreakerToStable: risk.liquidateToBaseOnMaxDrawdown,
      sourceSignal: declared ?? "MACRO_ALLOCATION",
    };
  }
  if (sig === "DUAL_MOMENTUM") {
    const sma = input.algoLogic?.sma ?? { fastPeriod: 20, slowPeriod: 50 };
    return {
      kind: "sma_crossover",
      fast: sma.fastPeriod,
      slow: sma.slowPeriod,
      stopLossFrac: risk.stopLossPercentage,
      trailingStop: risk.trailingStop,
      maxDrawdownFrac: risk.maxDrawdownLimit,
      circuitBreakerToStable: risk.liquidateToBaseOnMaxDrawdown,
      sourceSignal: declared ?? "DUAL_MOMENTUM",
    };
  }
  if (sig === "ASYMMETRIC_TREND_MOMENTUM") {
    const sma = input.algoLogic?.sma ?? { fastPeriod: 20, slowPeriod: 50 };
    return {
      kind: "sma_crossover",
      fast: sma.fastPeriod,
      slow: sma.slowPeriod,
      stopLossFrac: risk.stopLossPercentage,
      trailingStop: risk.trailingStop,
      maxDrawdownFrac: risk.maxDrawdownLimit,
      circuitBreakerToStable: risk.liquidateToBaseOnMaxDrawdown,
      sourceSignal: declared ?? "ASYMMETRIC_TREND_MOMENTUM",
    };
  }
  if (sig === "RSI" && input.algoLogic?.rsi) {
    return {
      kind: "rsi",
      period: input.algoLogic.rsi.period,
      oversold: input.algoLogic.rsi.oversold,
      overbought: input.algoLogic.rsi.overbought,
      stopLossFrac: risk.stopLossPercentage,
      trailingStop: risk.trailingStop,
      maxDrawdownFrac: risk.maxDrawdownLimit,
      circuitBreakerToStable: risk.liquidateToBaseOnMaxDrawdown,
      sourceSignal: declared ?? "RSI",
    };
  }
  if (sig === "Z_SCORE" && input.algoLogic?.zScore) {
    return {
      kind: "z_score",
      lookback: input.algoLogic.zScore.lookback,
      entryZ: input.algoLogic.zScore.entryZ,
      exitZ: input.algoLogic.zScore.exitZ,
      stopLossFrac: risk.stopLossPercentage,
      trailingStop: risk.trailingStop,
      maxDrawdownFrac: risk.maxDrawdownLimit,
      circuitBreakerToStable: risk.liquidateToBaseOnMaxDrawdown,
      sourceSignal: declared ?? "Z_SCORE",
    };
  }

  const sma = input.algoLogic?.sma ?? { fastPeriod: 20, slowPeriod: 50 };
  return {
    kind: "sma_crossover",
    fast: sma.fastPeriod,
    slow: sma.slowPeriod,
    stopLossFrac: risk.stopLossPercentage,
    trailingStop: risk.trailingStop,
    maxDrawdownFrac: risk.maxDrawdownLimit,
    circuitBreakerToStable: risk.liquidateToBaseOnMaxDrawdown,
    sourceSignal: declared ?? "SMA_CROSSOVER",
  };
}
