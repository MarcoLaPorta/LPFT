import type { PriceMatrix } from "../market_data/types";
import type { RegimeAnalysisResult } from "./regime-analysis";

export type RebalanceFrequency = "MONTHLY" | "QUARTERLY" | "NONE" | "DAILY_SIGNAL";

export type SignalKind =
  | "buy_and_hold"
  | "dual_momentum"
  | "asymmetric_trend_momentum"
  | "sma_crossover"
  | "rsi"
  | "z_score"
  | "macro_allocation"
  /** Test / stress: alterna 100% long / cash ogni giorno (ping-pong). */
  | "alternating";

export type AsymmetricTrendMomentumParams = {
  lookbackPeriodDays: number;
  equitySmaPeriod: number;
  cryptoEmaPeriod: number;
  equityTicker: string;
  cryptoTicker: string;
  safeHavenTicker: string;
};

export type EventDrivenStrategyConfig = {
  sourceSignal: string;
  primaryTicker: string;
  benchmark: string;
  universe: string[];
  baseCurrency: string;
  rebalanceFrequency: RebalanceFrequency;
  /** Fee taker istituzionale (bps). Daily usa ordini a mercato → taker su ogni gamba. */
  takerFeeBps?: number;
  /** Slippage + spread sul fill (bps). BUY: prezzo × (1+bps/1e4); SELL: prezzo × (1-bps/1e4). */
  slippageBps?: number;
  risk: {
    maxDrawdownLimit: number;
    stopLossPercentage: number;
    trailingStop: boolean;
    liquidateToBaseOnMaxDrawdown: boolean;
  };
  /** Tier 1 Phase 3 — cap peso con fractional Kelly (es. 0.25 = quarter-Kelly). */
  positionSizing?: {
    fractionalKelly: number;
    enableKellyCap: boolean;
  };
  signal: {
    kind: SignalKind;
    dualMomentumLookback?: number;
    smaFast?: number;
    smaSlow?: number;
    rsiPeriod?: number;
    rsiOversold?: number;
    rsiOverbought?: number;
    zLookback?: number;
    zEntry?: number;
    zExit?: number;
    reentrySmaDays?: number;
    asymmetricTrendMomentum?: AsymmetricTrendMomentumParams;
  };
};

export type PortfolioState = {
  currentDate: string;
  cash: number;
  positions: Record<string, number>;
  portfolioValue: number;
  highWaterMark: number;
  /** @deprecated Usare isHalted. */
  safeMode: boolean;
  /**
   * Sospensione risk temporanea (max DD): nessun nuovo ingresso fino al prossimo reset
   * di ciclo MONTHLY/QUARTERLY in Fase C.
   */
  isHalted: boolean;
  /** Prezzo medio di carico per stop-loss per posizione. */
  entryPrices: Record<string, number>;
};

export type BacktestPoint = {
  date: string;
  equity: number;
  benchmark: number;
};

export type BacktestMetrics = {
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
};

export type SimulatedTrade = {
  tradeIndex: number;
  side: "LONG";
  symbol: string;
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  entryEquity: number;
  exitEquity: number;
  pnlFrac: number;
  pnlEquity: number;
  reasonEntry: string;
  reasonExit: string;
  /** Fee cumulate pagate su entry + exit (base currency). */
  transactionFee: number;
};

export type ForwardProjection = {
  horizonDays: number;
  lookbackDays: number;
  expectedEquityMultiple: number;
  p05EquityMultiple: number;
  p95EquityMultiple: number;
  mcTerminalMultiples?: number[];
};

export type BacktestResult = {
  series: BacktestPoint[];
  metrics: BacktestMetrics;
  benchmarkMetrics: BacktestMetrics;
  projection?: ForwardProjection;
  trades: SimulatedTrade[];
  regimeAnalysis?: RegimeAnalysisResult;
  pitGuardEnabled?: boolean;
};

export type EventDrivenBacktestInput = {
  matrix: PriceMatrix;
  config: EventDrivenStrategyConfig;
  initialCash?: number;
  projectionHorizonDays?: number;
  projectionMcPaths?: number;
  projectionLookback?: number;
};

/** @deprecated StrategySpec legacy — adapter verso EventDrivenStrategyConfig. */
export type BuyHoldStrategy = { kind: "buy_and_hold"; sourceSignal?: string };
export type DrawdownToStableStrategy = {
  kind: "drawdown_to_stable";
  maxDrawdownFrac: number;
  reentrySmaDays: number;
  stopLossFrac?: number;
  trailingStop?: boolean;
  circuitBreakerToStable?: boolean;
  sourceSignal?: string;
};
export type SmaCrossoverStrategy = {
  kind: "sma_crossover";
  fast: number;
  slow: number;
  stopLossFrac?: number;
  trailingStop?: boolean;
  maxDrawdownFrac?: number;
  circuitBreakerToStable?: boolean;
  sourceSignal?: string;
};
export type RsiStrategy = {
  kind: "rsi";
  period: number;
  oversold: number;
  overbought: number;
  stopLossFrac?: number;
  trailingStop?: boolean;
  maxDrawdownFrac?: number;
  circuitBreakerToStable?: boolean;
  sourceSignal?: string;
};
export type ZScoreStrategy = {
  kind: "z_score";
  lookback: number;
  entryZ: number;
  exitZ: number;
  stopLossFrac?: number;
  trailingStop?: boolean;
  maxDrawdownFrac?: number;
  circuitBreakerToStable?: boolean;
  sourceSignal?: string;
};
export type StrategySpec =
  | BuyHoldStrategy
  | DrawdownToStableStrategy
  | SmaCrossoverStrategy
  | RsiStrategy
  | ZScoreStrategy;
