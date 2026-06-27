/**
 * AFX Quant — backtest pubblico.
 * Il core è event-driven (runEventDrivenBacktest); questo modulo espone API legacy e tipi.
 */
export type {
  BacktestMetrics,
  BacktestPoint,
  BacktestResult,
  BuyHoldStrategy,
  DrawdownToStableStrategy,
  EventDrivenBacktestInput,
  EventDrivenStrategyConfig,
  ForwardProjection,
  RsiStrategy,
  SimulatedTrade,
  SmaCrossoverStrategy,
  StrategySpec,
  ZScoreStrategy,
} from "./types";

export { runEventDrivenBacktest } from "./event-driven-engine";
export { compileToEventDrivenConfig, legacySpecToEventConfig, alignedRowsToPriceMatrix } from "./strategy-adapter";
export { computeMetricsFromEquity, projectForwardFromCloses } from "./metrics";

import type { AlignedPriceRow } from "../market_data/types";
import type { BacktestResult, StrategySpec } from "./types";
import { BacktestEngineError } from "./backtest-errors";
import { runEventDrivenBacktest } from "./event-driven-engine";
import { alignedRowsToPriceMatrix, legacySpecToEventConfig } from "./strategy-adapter";

/**
 * Simulazione legacy su righe allineate (delega al motore event-driven).
 * Nuovo codice: preferire `fetchUniversePriceMatrix` + `runEventDrivenBacktest`.
 */
export function runStrategyBacktest(
  aligned: AlignedPriceRow[],
  strategy: StrategySpec,
  options?: { projectionHorizonDays?: number; projectionMcPaths?: number; projectionLookback?: number },
): BacktestResult {
  if (aligned.length < 2) {
    throw new BacktestEngineError(
      "INSUFFICIENT_CALENDAR",
      `Backtest legacy: meno di 2 barre allineate (${aligned.length}).`,
    );
  }
  const primary = "ASSET";
  const benchmark = "BENCH";
  const matrix = alignedRowsToPriceMatrix(aligned, primary, benchmark);
  const config = legacySpecToEventConfig(strategy, primary, benchmark);
  return runEventDrivenBacktest({
    matrix,
    config,
    projectionHorizonDays: options?.projectionHorizonDays,
    projectionMcPaths: options?.projectionMcPaths,
    projectionLookback: options?.projectionLookback,
  });
}
