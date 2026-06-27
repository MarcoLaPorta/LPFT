import type { BuildQuantitativeStrategyInput } from "../../lib/afx-quant-strategy-schema";
import type { AlignedPriceRow, PriceMatrix } from "../market_data/types";
import { defaultSlippageBpsForSymbol, resolveFeeBps } from "./trading-friction";
import type { EventDrivenStrategyConfig, StrategySpec } from "./types";

function executionFrictionFromRisk(
  risk: BuildQuantitativeStrategyInput["riskManagement"],
  primaryTicker: string,
): Pick<EventDrivenStrategyConfig, "takerFeeBps" | "slippageBps"> {
  const fees = resolveFeeBps(risk);
  return {
    takerFeeBps: fees.takerFeeBps,
    slippageBps: risk.slippageBps ?? defaultSlippageBpsForSymbol(primaryTicker),
  };
}

export function compileToEventDrivenConfig(
  input: BuildQuantitativeStrategyInput,
): EventDrivenStrategyConfig {
  const risk = input.riskManagement;
  const primary = input.backtest.primaryTicker.toUpperCase();
  const { takerFeeBps, slippageBps } = executionFrictionFromRisk(risk, primary);
  const benchmark = (input.backtest.benchmark ?? "^GSPC").toUpperCase();
  const universe = input.universe.assets.map((a) => a.toUpperCase());
  if (!universe.includes(primary)) universe.unshift(primary);

  const positionSizing = {
    fractionalKelly: risk.fractionalKelly ?? 0.25,
    enableKellyCap: risk.enableKellyCap !== false,
  };

  const baseRisk = {
    maxDrawdownLimit: risk.maxDrawdownLimit,
    stopLossPercentage: risk.stopLossPercentage,
    trailingStop: risk.trailingStop,
    liquidateToBaseOnMaxDrawdown: risk.liquidateToBaseOnMaxDrawdown,
  };

  if (input.intentClass === "WALLET_MANAGEMENT") {
    const freq = input.walletLogic?.rebalanceFrequency ?? "MONTHLY";
    const rebal: EventDrivenStrategyConfig["rebalanceFrequency"] =
      freq === "QUARTERLY" ? "QUARTERLY" : freq === "NONE" ? "NONE" : "MONTHLY";
    return {
      sourceSignal: "MACRO_ALLOCATION",
      primaryTicker: primary,
      benchmark,
      universe,
      baseCurrency: input.universe.baseCurrency,
      rebalanceFrequency: rebal,
      takerFeeBps,
      slippageBps,
      risk: baseRisk,
      positionSizing,
      signal: {
        kind: "macro_allocation",
        reentrySmaDays: rebal === "QUARTERLY" ? 63 : 21,
      },
    };
  }

  const declared = input.algoLogic?.signal ?? "SMA_CROSSOVER";
  const sig = declared;

  if (sig === "MACRO_REGIME_BREAKOUT" || sig === "MACRO_ALLOCATION") {
    return {
      sourceSignal: declared ?? "MACRO_ALLOCATION",
      primaryTicker: primary,
      benchmark,
      universe,
      baseCurrency: input.universe.baseCurrency,
      rebalanceFrequency: "MONTHLY",
      takerFeeBps,
      slippageBps,
      risk: baseRisk,
      positionSizing,
      signal: {
        kind: "macro_allocation",
        reentrySmaDays: 21,
      },
    };
  }

  if (sig === "DUAL_MOMENTUM") {
    return {
      sourceSignal: declared,
      primaryTicker: primary,
      benchmark,
      universe,
      baseCurrency: input.universe.baseCurrency,
      rebalanceFrequency: "MONTHLY",
      takerFeeBps,
      slippageBps,
      risk: baseRisk,
      positionSizing,
      signal: { kind: "dual_momentum", dualMomentumLookback: 90 },
    };
  }

  if (sig === "ASYMMETRIC_TREND_MOMENTUM") {
    const p = input.algoLogic?.asymmetricTrendMomentum ?? {
      lookbackPeriodDays: 90,
      equitySmaPeriod: 100,
      cryptoEmaPeriod: 50,
      equityTicker: "QQQ",
      cryptoTicker: "BTC-USD",
      safeHavenTicker: "GLD",
    };
    const atmUniverse = [...universe];
    for (const t of [p.equityTicker, p.cryptoTicker, p.safeHavenTicker]) {
      const u = t.toUpperCase();
      if (!atmUniverse.includes(u)) atmUniverse.push(u);
    }
    return {
      sourceSignal: declared,
      primaryTicker: primary,
      benchmark,
      universe: atmUniverse,
      baseCurrency: input.universe.baseCurrency,
      rebalanceFrequency: "MONTHLY",
      takerFeeBps,
      slippageBps,
      risk: baseRisk,
      positionSizing,
      signal: {
        kind: "asymmetric_trend_momentum",
        asymmetricTrendMomentum: {
          lookbackPeriodDays: p.lookbackPeriodDays,
          equitySmaPeriod: p.equitySmaPeriod,
          cryptoEmaPeriod: p.cryptoEmaPeriod,
          equityTicker: p.equityTicker.toUpperCase(),
          cryptoTicker: p.cryptoTicker.toUpperCase(),
          safeHavenTicker: p.safeHavenTicker.toUpperCase(),
        },
      },
    };
  }

  if (sig === "RSI" && input.algoLogic?.rsi) {
    return {
      sourceSignal: declared,
      primaryTicker: primary,
      benchmark,
      universe,
      baseCurrency: input.universe.baseCurrency,
      rebalanceFrequency: "DAILY_SIGNAL",
      takerFeeBps,
      slippageBps,
      risk: baseRisk,
      positionSizing,
      signal: {
        kind: "rsi",
        rsiPeriod: input.algoLogic.rsi.period,
        rsiOversold: input.algoLogic.rsi.oversold,
        rsiOverbought: input.algoLogic.rsi.overbought,
      },
    };
  }

  if (sig === "Z_SCORE" && input.algoLogic?.zScore) {
    return {
      sourceSignal: declared,
      primaryTicker: primary,
      benchmark,
      universe,
      baseCurrency: input.universe.baseCurrency,
      rebalanceFrequency: "DAILY_SIGNAL",
      takerFeeBps,
      slippageBps,
      risk: baseRisk,
      positionSizing,
      signal: {
        kind: "z_score",
        zLookback: input.algoLogic.zScore.lookback,
        zEntry: input.algoLogic.zScore.entryZ,
        zExit: input.algoLogic.zScore.exitZ,
      },
    };
  }

  const sma = input.algoLogic?.sma ?? { fastPeriod: 20, slowPeriod: 50 };
  return {
    sourceSignal: declared,
    primaryTicker: primary,
    benchmark,
    universe,
    baseCurrency: input.universe.baseCurrency,
    rebalanceFrequency: "DAILY_SIGNAL",
    takerFeeBps,
    slippageBps,
    risk: baseRisk,
    positionSizing,
    signal: {
      kind: "sma_crossover",
      smaFast: sma.fastPeriod,
      smaSlow: sma.slowPeriod,
    },
  };
}

/** Adapter legacy StrategySpec → EventDrivenStrategyConfig (coppia asset/benchmark). */
export function legacySpecToEventConfig(
  strategy: StrategySpec,
  primary: string,
  benchmark: string,
): EventDrivenStrategyConfig {
  const tag = "sourceSignal" in strategy && strategy.sourceSignal ? strategy.sourceSignal : strategy.kind;
  const base = {
    sourceSignal: tag,
    primaryTicker: primary.toUpperCase(),
    benchmark: benchmark.toUpperCase(),
    universe: [primary.toUpperCase()],
    baseCurrency: "USDC" as const,
    rebalanceFrequency: "DAILY_SIGNAL" as const,
    takerFeeBps: 0,
    slippageBps: defaultSlippageBpsForSymbol(primary),
    risk: {
      maxDrawdownLimit: 0.15,
      stopLossPercentage: 0.1,
      trailingStop: false,
      liquidateToBaseOnMaxDrawdown: true,
    },
  };

  if (strategy.kind === "buy_and_hold") {
    return {
      ...base,
      rebalanceFrequency: "NONE",
      risk: { ...base.risk, maxDrawdownLimit: 1, stopLossPercentage: 1 },
      signal: { kind: "buy_and_hold" },
    };
  }
  if (strategy.kind === "drawdown_to_stable") {
    return {
      ...base,
      sourceSignal: strategy.sourceSignal ?? "MACRO_ALLOCATION",
      rebalanceFrequency: "DAILY_SIGNAL",
      risk: {
        maxDrawdownLimit: strategy.maxDrawdownFrac,
        stopLossPercentage: strategy.stopLossFrac ?? 0.1,
        trailingStop: strategy.trailingStop ?? false,
        liquidateToBaseOnMaxDrawdown: strategy.circuitBreakerToStable !== false,
      },
      signal: { kind: "macro_allocation", reentrySmaDays: strategy.reentrySmaDays },
    };
  }
  if (strategy.kind === "rsi") {
    return {
      ...base,
      sourceSignal: strategy.sourceSignal ?? "RSI",
      risk: {
        maxDrawdownLimit: strategy.maxDrawdownFrac ?? 0.15,
        stopLossPercentage: strategy.stopLossFrac ?? 0.1,
        trailingStop: strategy.trailingStop ?? false,
        liquidateToBaseOnMaxDrawdown: strategy.circuitBreakerToStable !== false,
      },
      signal: {
        kind: "rsi",
        rsiPeriod: strategy.period,
        rsiOversold: strategy.oversold,
        rsiOverbought: strategy.overbought,
      },
    };
  }
  if (strategy.kind === "z_score") {
    return {
      ...base,
      sourceSignal: strategy.sourceSignal ?? "Z_SCORE",
      risk: {
        maxDrawdownLimit: strategy.maxDrawdownFrac ?? 0.15,
        stopLossPercentage: strategy.stopLossFrac ?? 0.1,
        trailingStop: strategy.trailingStop ?? false,
        liquidateToBaseOnMaxDrawdown: strategy.circuitBreakerToStable !== false,
      },
      signal: {
        kind: "z_score",
        zLookback: strategy.lookback,
        zEntry: strategy.entryZ,
        zExit: strategy.exitZ,
      },
    };
  }
  return {
    ...base,
    sourceSignal: strategy.sourceSignal ?? "SMA_CROSSOVER",
    risk: {
      maxDrawdownLimit: strategy.maxDrawdownFrac ?? 0.15,
      stopLossPercentage: strategy.stopLossFrac ?? 0.1,
      trailingStop: strategy.trailingStop ?? false,
      liquidateToBaseOnMaxDrawdown: strategy.circuitBreakerToStable !== false,
    },
    signal: {
      kind: "sma_crossover",
      smaFast: strategy.fast,
      smaSlow: strategy.slow,
    },
  };
}

export function alignedRowsToPriceMatrix(
  aligned: AlignedPriceRow[],
  assetSymbol: string,
  benchmarkSymbol: string,
): PriceMatrix {
  const calendar = aligned.map((r) => r.date);
  return {
    calendar,
    symbols: [assetSymbol.toUpperCase(), benchmarkSymbol.toUpperCase()],
    prices: {
      [assetSymbol.toUpperCase()]: aligned.map((r) => r.assetClose),
      [benchmarkSymbol.toUpperCase()]: aligned.map((r) => r.benchClose),
    },
  };
}
