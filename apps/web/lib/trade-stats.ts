import type { SimulatedTrade } from "../services/quant/backtest";
import type { BacktestPointView } from "./afx-analysis-types";

export type TradeSummary = {
  count: number;
  winRate: number;
  avgPnlFrac: number;
  avgWinFrac: number;
  avgLossFrac: number;
  bestFrac: number;
  worstFrac: number;
  profitFactor: number;
  avgHoldDays: number;
};

export function summarizeTrades(trades: SimulatedTrade[]): TradeSummary | null {
  if (trades.length === 0) return null;

  const wins = trades.filter((t) => t.pnlFrac > 0);
  const losses = trades.filter((t) => t.pnlFrac <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlFrac, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlFrac, 0));

  let holdDays = 0;
  for (const t of trades) {
    const a = new Date(t.entryDate).getTime();
    const b = new Date(t.exitDate).getTime();
    if (Number.isFinite(a) && Number.isFinite(b)) holdDays += Math.max(0, (b - a) / 86400000);
  }

  const pnls = trades.map((t) => t.pnlFrac);

  return {
    count: trades.length,
    winRate: wins.length / trades.length,
    avgPnlFrac: pnls.reduce((a, b) => a + b, 0) / trades.length,
    avgWinFrac: wins.length ? grossWin / wins.length : 0,
    avgLossFrac: losses.length ? losses.reduce((s, t) => s + t.pnlFrac, 0) / losses.length : 0,
    bestFrac: Math.max(...pnls),
    worstFrac: Math.min(...pnls),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgHoldDays: holdDays / trades.length,
  };
}

export function maxDrawdownFromSeries(series: BacktestPointView[]): number {
  if (series.length < 2) return 0;
  let peak = series[0].equity;
  let maxDd = 0;
  for (const p of series) {
    if (p.equity > peak) peak = p.equity;
    const dd = p.equity / peak - 1;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

export function yearlyReturns(series: BacktestPointView[]): { year: string; ret: number }[] {
  if (series.length < 2) return [];
  const byYear = new Map<string, { first: number; last: number }>();
  for (const p of series) {
    const year = p.date.slice(0, 4);
    const cur = byYear.get(year);
    if (!cur) byYear.set(year, { first: p.equity, last: p.equity });
    else cur.last = p.equity;
  }
  return [...byYear.entries()].map(([year, v]) => ({
    year,
    ret: v.first > 0 ? v.last / v.first - 1 : 0,
  }));
}
