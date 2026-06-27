import type {
  BacktestPoint,
  BacktestResult,
  EventDrivenBacktestInput,
  EventDrivenStrategyConfig,
  PortfolioState,
} from "./types";
import {
  buildActiveSessionMask,
  buildCombinedActiveSessionMask,
  estimateTradingDaysPerYear,
  resolveRegulatedSessionProxy,
} from "../market_data/price_matrix";
import { closePosition, executeForcedLiquidation, executeRebalance } from "./execution-engine";
import type { ExecutionFriction } from "./execution-engine";
import { computeMetricsFromEquity, projectForwardFromCloses } from "./metrics";
import {
  createInitialPortfolio,
  markToMarket,
  releaseMonthlyRiskHalt,
  seedHighWaterMarkIfNeeded,
  updateHighWaterMark,
} from "./portfolio-state";
import { computePortfolioDrawdown, evaluatePortfolioRisk } from "./risk-manager";
import {
  computeTargetWeights,
  formatTargetReason,
  isRebalanceDay,
} from "./signal-engine";
import { BacktestEngineError } from "./backtest-errors";
import { TradeJournal } from "./trade-journal";
import { applyFractionalKellyCap } from "./kelly-sizing";
import { sliceMatrixAsOf } from "./pit-proxy";
import { analyzeMarketRegimes } from "./regime-analysis";
import { resolveSlippageBpsForSymbol } from "./trading-friction";

type PendingRebalance = {
  signalDayIndex: number;
  target: Record<string, number>;
  reason: string;
};

type PendingRiskOrder =
  | { kind: "halt_portfolio"; queuedDayIndex: number; reason: string }
  | { kind: "close_position"; queuedDayIndex: number; symbol: string; reason: string };

function pricesAtIndex(
  matrix: EventDrivenBacktestInput["matrix"],
  dayIndex: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const sym of matrix.symbols) {
    out[sym] = matrix.prices[sym][dayIndex];
  }
  return out;
}

function frictionFromConfig(config: EventDrivenStrategyConfig): ExecutionFriction {
  const slippageBySymbol: Record<string, number> = {};
  for (const sym of config.universe) {
    slippageBySymbol[sym.toUpperCase()] = resolveSlippageBpsForSymbol(sym, config.slippageBps);
  }
  slippageBySymbol[config.primaryTicker.toUpperCase()] = resolveSlippageBpsForSymbol(
    config.primaryTicker,
    config.slippageBps,
  );
  slippageBySymbol[config.benchmark.toUpperCase()] = resolveSlippageBpsForSymbol(
    config.benchmark,
    config.slippageBps,
  );
  return {
    takerFeeBps: config.takerFeeBps ?? 0,
    slippageBps: config.slippageBps ?? 0,
    symbolSlippageBps: slippageBySymbol,
  };
}

function currentWeightVector(
  state: PortfolioState,
  prices: Record<string, number>,
): Record<string, number> {
  const pv = state.portfolioValue;
  if (pv <= 0) return {};
  const w: Record<string, number> = {};
  for (const [sym, qty] of Object.entries(state.positions)) {
    const px = prices[sym];
    if (px != null && qty > 0) w[sym] = (qty * px) / pv;
  }
  return w;
}

function mergeRsiHoldWeights(
  target: Record<string, number>,
  current: Record<string, number>,
  primary: string,
): Record<string, number> {
  if (target[primary] !== undefined && target[primary] !== 0) return target;
  if (Object.keys(target).length === 0) return current;
  const t = { ...target };
  if (t[primary] === undefined || (t[primary] === 0 && (current[primary] ?? 0) > 0)) {
    t[primary] = current[primary] ?? 0;
  }
  return t;
}

function hasRiskAssets(weights: Record<string, number>): boolean {
  return Object.values(weights).some((w) => w > 0.001);
}

/** Reset halt risk all'inizio di ogni ciclo MONTHLY / QUARTERLY (prima di segnali ed esecuzione T+1). */
function isPeriodicRiskResetDay(
  matrix: EventDrivenBacktestInput["matrix"],
  dayIndex: number,
  config: EventDrivenStrategyConfig,
): boolean {
  const freq = config.rebalanceFrequency;
  if (freq !== "MONTHLY" && freq !== "QUARTERLY") return false;
  return isRebalanceDay(matrix.calendar, dayIndex, freq);
}

function isSignalRebalanceDue(
  matrix: EventDrivenBacktestInput["matrix"],
  dayIndex: number,
  config: EventDrivenStrategyConfig,
): boolean {
  const day0 = dayIndex === 0;
  if (day0 && (config.signal.kind === "buy_and_hold" || config.signal.kind === "alternating")) {
    return true;
  }
  if (config.rebalanceFrequency === "DAILY_SIGNAL") {
    return !day0;
  }
  if (config.rebalanceFrequency === "NONE") {
    return false;
  }
  return isRebalanceDay(matrix.calendar, dayIndex, config.rebalanceFrequency);
}

/**
 * Motore Daily (event-driven) — ORCHESTRAZIONE TypeScript.
 *
 * Responsabilità TS:
 * - Aggregazione OHLCV, scheduling segnali T+1, risk stops, rebalance
 * - Fee/slippage locale (takerFeeBps — ordini a mercato daily)
 * - Metriche equity leggere (CAGR/Sharpe/maxDD) per UI e guardrail
 * - Regime windows lightweight (Covid/bear/rates proxy)
 *
 * DELEGATED TO LPFT PYTHON (lpft-tier1.ts, chiamato da afx-chat-tools):
 * - CPCV, Deflated Sharpe Ratio, CVaR, Monte Carlo 10k paths
 *
 * Non duplicare qui la matematica Tier-1 pesante.
 *
 * Fase C: segnale a fine giorno i, esecuzione T+1 al prezzo del giorno i+1.
 */
export function runEventDrivenBacktest(input: EventDrivenBacktestInput): BacktestResult {
  const { matrix, config } = input;
  const n = matrix.calendar.length;
  const initialCash = input.initialCash ?? 1;
  const benchSym = config.benchmark.toUpperCase();
  const primary = config.primaryTicker.toUpperCase();
  const friction = frictionFromConfig(config);

  if (n < 2) {
    throw new BacktestEngineError(
      "INSUFFICIENT_CALENDAR",
      `Master loop impossibile: calendario con ${n} giorno/i (minimo 2). Verificare download ticker e allineamento date.`,
    );
  }

  const state = createInitialPortfolio(initialCash);
  const journal = new TradeJournal();
  const series: BacktestPoint[] = [];
  let bench = 1;
  let pending: PendingRebalance | null = null;

  const sessionProxy =
    resolveRegulatedSessionProxy(matrix, config.benchmark) ??
    resolveRegulatedSessionProxy(matrix, primary);
  const metricSymbols = [config.primaryTicker, config.benchmark, ...config.universe];
  const activeSessionMask = sessionProxy
    ? buildCombinedActiveSessionMask(matrix, sessionProxy, metricSymbols)
    : buildActiveSessionMask(matrix, primary, primary);
  const tradingDaysPerYear = estimateTradingDaysPerYear(activeSessionMask, n);
  const metricsOptions = { activeSessionMask, tradingDaysPerYear };
  let pendingRisk: PendingRiskOrder | null = null;

  for (let i = 0; i < n; i++) {
    const date = matrix.calendar[i];
    state.currentDate = date;
    const prices = pricesAtIndex(matrix, i);

    // —— Reset halt mensile/trimestrale (prima di T+1 e nuovi segnali Fase C) ——
    if (isPeriodicRiskResetDay(matrix, i, config)) {
      releaseMonthlyRiskHalt(state);
    }

    // —— T+1: esecuzione ordini risk generati a fine giorno i-1 (prioritari su segnale) ——
    if (i > 0 && pendingRisk != null) {
      if (pendingRisk.kind === "halt_portfolio") {
        if (!state.isHalted) {
          executeForcedLiquidation(state, prices, pendingRisk.reason, journal, friction, true);
        }
        pending = null;
      } else if (state.positions[pendingRisk.symbol] != null) {
        closePosition(state, pendingRisk.symbol, prices, pendingRisk.reason, journal, friction);
      }
      pendingRisk = null;
    }

    // —— T+1: esecuzione ordini segnale generati a fine giorno i-1 (fill proxy = close giorno i) ——
    if (i > 0 && pending != null && !state.isHalted) {
      executeRebalance(state, i, prices, pending.target, pending.reason, journal, friction);
      pending = null;
    }

    // —— FASE A: Mark-to-Market ——
    state.portfolioValue = markToMarket(state, prices);
    seedHighWaterMarkIfNeeded(state);
    updateHighWaterMark(state);

    const day0 = i === 0;
    const hasPositions = Object.values(state.positions).some((q) => q > 1e-12);

    // —— FASE B: Risk Management (fine giornata; mai al giorno 0) ——
    if (!day0 && hasPositions && !state.isHalted) {
      const risk = evaluatePortfolioRisk(state, prices, config);
      if (risk.kind === "halt_portfolio" && pendingRisk == null) {
        const dd = computePortfolioDrawdown(state);
        console.info(
          `[AFX] Portfolio HALTED ${state.currentDate} | DD ${dd != null ? `${(dd * 100).toFixed(2)}%` : "n/a"} | limit ${(config.risk.maxDrawdownLimit * 100).toFixed(0)}%`,
        );
        pendingRisk = { kind: "halt_portfolio", queuedDayIndex: i, reason: risk.reason };
        pending = null;
      } else if (
        risk.kind === "close_position" &&
        pendingRisk == null &&
        state.positions[risk.symbol] != null
      ) {
        pendingRisk = {
          kind: "close_position",
          queuedDayIndex: i,
          symbol: risk.symbol,
          reason: risk.reason,
        };
      }
    }

    // —— FASE C (segnale): calcolo target a fine giorno i per fill T+1 ——
    if (!state.isHalted && isSignalRebalanceDue(matrix, i, config) && i < n - 1) {
      const pitMatrix = sliceMatrixAsOf(matrix, i);
      let target = computeTargetWeights(pitMatrix, i, config);
      if (config.signal.kind === "rsi") {
        target = mergeRsiHoldWeights(target, currentWeightVector(state, prices), primary);
      }
      if (config.positionSizing?.enableKellyCap === true) {
        target = applyFractionalKellyCap(target, journal.trades, {
          fractionalKelly: config.positionSizing.fractionalKelly ?? 0.25,
          enabled: true,
        });
      }
      const reason = formatTargetReason(config, target);
      if (hasRiskAssets(target) || Object.keys(state.positions).length > 0) {
        pending = { signalDayIndex: i, target, reason };
      }
    }

    state.portfolioValue = markToMarket(state, prices);
    seedHighWaterMarkIfNeeded(state);
    updateHighWaterMark(state);

    if (i > 0) {
      const b0 = matrix.prices[benchSym]?.[i - 1];
      const b1 = matrix.prices[benchSym]?.[i];
      if (b0 != null && b1 != null && b0 > 0) bench *= b1 / b0;
    }

    const eqNorm = state.portfolioValue / initialCash;
    series.push({ date, equity: eqNorm, benchmark: bench });
  }

  const lastPrices = pricesAtIndex(matrix, n - 1);
  journal.finalizeAll(matrix.calendar[n - 1], lastPrices, state.portfolioValue);

  const eq = series.map((p) => p.equity);
  const bm = series.map((p) => p.benchmark);
  // Metriche equity leggere — orchestrazione TS (Tier-1 pesante: DELEGATED TO LPFT PYTHON).
  const metrics = computeMetricsFromEquity(eq, metricsOptions);
  const benchmarkMetrics = computeMetricsFromEquity(bm, metricsOptions);

  let projection: BacktestResult["projection"];
  const H = input.projectionHorizonDays;
  if (H != null && H > 0) {
    const closes = matrix.prices[primary] ?? [];
    // Preview MC locale; validazione MC 10k paths: DELEGATED TO LPFT PYTHON (tier1Validation).
    projection = projectForwardFromCloses(closes, H, {
      lookback: input.projectionLookback,
      mcPaths: input.projectionMcPaths,
    });
  }

  // Proxy regime windows TS — non sostituisce CPCV/DSR Python.
  const regimeAnalysis = analyzeMarketRegimes(series);

  return {
    series,
    metrics,
    benchmarkMetrics,
    projection,
    trades: journal.trades,
    regimeAnalysis,
    pitGuardEnabled: true,
  };
}
