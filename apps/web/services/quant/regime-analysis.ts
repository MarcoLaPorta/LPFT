import type { BacktestPoint, BacktestMetrics, SimulatedTrade } from "./types";
import { computeMetricsFromEquity } from "./metrics";

/** Finestre di stress note (storico mercati USA / global proxy). */
export const KNOWN_STRESS_REGIMES = [
  {
    id: "covid_crash",
    label: "Covid-19 crash",
    start: "2020-02-20",
    end: "2020-03-23",
  },
  {
    id: "bear_2022",
    label: "Bear market 2022",
    start: "2022-01-03",
    end: "2022-10-14",
  },
  {
    id: "rate_hike_2023",
    label: "Rate hike volatility",
    start: "2023-02-01",
    end: "2023-10-27",
  },
] as const;

export type RegimeWindowMetrics = {
  id: string;
  label: string;
  start: string;
  end: string;
  barCount: number;
  overlap: boolean;
  strategy: BacktestMetrics;
  benchmark: BacktestMetrics;
  relativeReturn: number;
};

export type RegimeAnalysisResult = {
  windows: RegimeWindowMetrics[];
  fullSample: BacktestMetrics;
  stressOnly?: BacktestMetrics;
};

function sliceSeriesByDate(
  series: BacktestPoint[],
  start: string,
  end: string,
): BacktestPoint[] {
  return series.filter((p) => p.date >= start && p.date <= end);
}

function metricsForSlice(slice: BacktestPoint[]): BacktestMetrics {
  if (slice.length < 2) {
    return { cagr: 0, sharpe: 0, maxDrawdown: 0 };
  }
  return computeMetricsFromEquity(slice.map((p) => p.equity));
}

/**
 * Segmenta l'equity curve su periodi di stress noti e calcola metriche isolate.
 */
export function analyzeMarketRegimes(
  series: BacktestPoint[],
): RegimeAnalysisResult {
  if (series.length < 2) {
    return {
      windows: [],
      fullSample: { cagr: 0, sharpe: 0, maxDrawdown: 0 },
    };
  }

  const fullSample = metricsForSlice(series);
  const windows: RegimeWindowMetrics[] = [];

  for (const regime of KNOWN_STRESS_REGIMES) {
    const stratSlice = sliceSeriesByDate(series, regime.start, regime.end);
    const overlap = stratSlice.length >= 2;
    const benchSlice = stratSlice.map((p) => ({
      date: p.date,
      equity: p.benchmark,
      benchmark: p.benchmark,
    }));

    const strategy = metricsForSlice(stratSlice);
    const benchmark = metricsForSlice(benchSlice);
    const relativeReturn =
      stratSlice.length >= 2
        ? stratSlice[stratSlice.length - 1].equity / stratSlice[0].equity - 1
        : 0;

    windows.push({
      id: regime.id,
      label: regime.label,
      start: regime.start,
      end: regime.end,
      barCount: stratSlice.length,
      overlap,
      strategy,
      benchmark,
      relativeReturn,
    });
  }

  const stressBars = series.filter((p) =>
    KNOWN_STRESS_REGIMES.some((r) => p.date >= r.start && p.date <= r.end),
  );
  const stressOnly =
    stressBars.length >= 5 ? metricsForSlice(stressBars) : undefined;

  return { windows, fullSample, stressOnly };
}

/** Kelly inputs da trade history (per sizing). */
export function tradeStatsForKelly(trades: SimulatedTrade[]): {
  winRate: number;
  avgWin: number;
  avgLoss: number;
  n: number;
} | null {
  const closed = trades.filter((t) => t.pnlFrac !== 0);
  if (closed.length < 5) return null;
  const wins = closed.filter((t) => t.pnlFrac > 0);
  const losses = closed.filter((t) => t.pnlFrac < 0);
  const winRate = wins.length / closed.length;
  const avgWin =
    wins.length > 0 ? wins.reduce((s, t) => s + t.pnlFrac, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0
      ? losses.reduce((s, t) => s + Math.abs(t.pnlFrac), 0) / losses.length
      : 0;
  if (avgLoss <= 0) return null;
  return { winRate, avgWin, avgLoss, n: closed.length };
}
