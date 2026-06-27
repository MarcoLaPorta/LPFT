import type { HFTScalpTrade, HFTSessionResult } from "./hft-types";
import type { BacktestPointView } from "../../lib/afx-analysis-types";

/** Metriche microstructure per sessioni HFT (sostituiscono CAGR/Sharpe daily). */
export type HFTSessionMetrics = {
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

function toDateOnly(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function computeHftSessionMetrics(session: HFTSessionResult): HFTSessionMetrics {
  const { trades } = session;
  const wins = trades.filter((t) => t.pnlBps > 0);
  const losses = trades.filter((t) => t.pnlBps <= 0);
  const winRate = trades.length > 0 ? wins.length / trades.length : 0;
  const avgWinBps =
    wins.length > 0 ? wins.reduce((s, t) => s + t.pnlBps, 0) / wins.length : 0;
  const avgLossBps =
    losses.length > 0 ? losses.reduce((s, t) => s + t.pnlBps, 0) / losses.length : 0;
  const maxTradeLossBps =
    trades.length > 0 ? Math.min(0, ...trades.map((t) => t.pnlBps)) : 0;
  const grossWin = wins.reduce((s, t) => s + t.pnlBps, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlBps, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null;

  return {
    sessionPnLBps: session.totalPnlBps,
    winRate,
    tradeCount: trades.length,
    avgWinBps,
    avgLossBps,
    maxTradeLossBps,
    profitFactor,
    avgLatencyMs: session.avgLatencyMs,
    ticksProcessed: session.ticksProcessed,
    bookUpdates: session.bookUpdates,
    halted: session.halted,
  };
}

function nextChartTime(used: Set<number>, tsMs: number): number {
  let sec = Math.floor(tsMs / 1000);
  while (used.has(sec)) sec += 1;
  used.add(sec);
  return sec;
}

/** Curva equity cumulativa da scalp HFT (base 1.0). `date` per tabelle; `chartTime` univoco per grafici. */
export function buildHftEquitySeries(trades: HFTScalpTrade[]): BacktestPointView[] {
  if (trades.length === 0) return [];
  const used = new Set<number>();
  const points: BacktestPointView[] = [
    {
      date: toDateOnly(trades[0].entryTs),
      chartTime: nextChartTime(used, trades[0].entryTs),
      equity: 1,
      benchmark: 1,
    },
  ];
  let eq = 1;
  for (const t of trades) {
    eq *= 1 + t.pnlBps / 10_000;
    points.push({
      date: toDateOnly(t.exitTs),
      chartTime: nextChartTime(used, t.exitTs),
      equity: eq,
      benchmark: 1,
    });
  }
  return points;
}
