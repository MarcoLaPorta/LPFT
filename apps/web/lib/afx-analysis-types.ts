import type { ForwardProjection, SimulatedTrade } from "../services/quant/backtest";

export type BacktestMetricsView = {
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
};

/** Metriche microstructure HFT — non usare CAGR/Sharpe daily. */
export type HFTSessionMetricsView = {
  sessionPnLBps: number;
  winRate: number;
  tradeCount: number;
  avgWinBps: number;
  avgLossBps: number;
  maxTradeLossBps: number;
  profitFactor: number | null;
  avgLatencyMs: number;
  ticksProcessed: number;
  bookUpdates: number;
  halted: boolean;
};

export type BacktestPointView = {
  date: string;
  equity: number;
  benchmark: number;
  /** Unix seconds for intraday/HFT charts (avoids duplicate yyyy-mm-dd). */
  chartTime?: number;
};

export type ProjectionsBundle = {
  days30: ForwardProjection;
  days90: ForwardProjection;
  days365: ForwardProjection;
};

export type DerivedBacktestStats = {
  totalReturn: number;
  benchmarkTotalReturn: number;
  alphaVsBenchmark: number;
  finalEquity: number;
  finalBenchmark: number;
  barCount: number;
  firstDate: string;
  lastDate: string;
};

export type MarketContextView = {
  ticker?: string;
  timeframe?: string;
  barCount?: number;
  firstDate?: string;
  lastDate?: string;
  lastClose?: number;
  meanClose?: number;
  suggestedRouting?: string;
  sampleTail?: { date: string; close: number }[];
  /** Validazione Tier-1 Python (CPCV, DSR, MC, CVaR) allegata al backtest. */
  tier1Validation?: unknown;
  regimeAnalysis?: RegimeAnalysisView;
  pitGuardEnabled?: boolean;
  /** Sessione HFT (mock o replay Alpaca). */
  hftSession?: unknown;
  /** Metriche microstructure HFT (sessionPnLBps, winRate, …). */
  hftMetrics?: HFTSessionMetricsView;
  engine?: string;
  replayMode?: string;
  replayStats?: unknown;
};

export type RegimeWindowView = {
  id: string;
  label: string;
  start: string;
  end: string;
  barCount: number;
  overlap: boolean;
  strategy: BacktestMetricsView;
  benchmark: BacktestMetricsView;
  relativeReturn: number;
};

export type RegimeAnalysisView = {
  windows: RegimeWindowView[];
  fullSample: BacktestMetricsView;
  stressOnly?: BacktestMetricsView;
};

export type StrategyAnalysisSnapshot = {
  source:
    | "buildQuantitativeStrategy"
    | "runStrategyBacktest"
    | "proposeExecution"
    | "analyzeMarketData";
  symbol: string;
  benchmark?: string;
  metrics?: BacktestMetricsView;
  benchmarkMetrics?: BacktestMetricsView;
  series?: BacktestPointView[];
  projections?: ProjectionsBundle;
  derived?: DerivedBacktestStats;
  strategy?: unknown;
  engineSpec?: unknown;
  intentClass?: string;
  intentSummary?: string;
  marketRoutingMode?: string;
  riskCapsApplied?: {
    maxDrawdownLimit: number;
    stopLossPercentage: number;
    trailingStop: boolean;
    makerFeeBps?: number;
    takerFeeBps?: number;
  };
  compiledStrategy?: unknown;
  marketContext?: MarketContextView;
  regimeAnalysis?: RegimeAnalysisView;
  pitGuardEnabled?: boolean;
  trades?: SimulatedTrade[];
  snapshotId?: string;
  reportUrl?: string;
  /** Collegamento a ExecutionLog DRAFT (proposeExecution). */
  executionLogId?: string | null;
  updatedAt: number;
};
