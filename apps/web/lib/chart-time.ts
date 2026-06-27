import type { Time } from "lightweight-charts";
import type { BacktestPointView } from "./afx-analysis-types";

export type ChartTimePoint = { time: Time; value: number };

/** Unix seconds for charting; falls back to UTC midnight of `date`. */
export function backtestPointUnixSec(p: BacktestPointView): number {
  if (p.chartTime != null && Number.isFinite(p.chartTime)) return Math.floor(p.chartTime);
  const parsed = Date.parse(p.date.includes("T") ? p.date : `${p.date}T00:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

/** Ensures strictly ascending unique times for lightweight-charts. */
export function toAscChartLineData(
  points: BacktestPointView[],
  value: (p: BacktestPointView) => number,
): ChartTimePoint[] {
  const used = new Set<number>();
  const out: ChartTimePoint[] = [];
  for (const p of points) {
    let t = backtestPointUnixSec(p);
    while (used.has(t)) t += 1;
    used.add(t);
    out.push({ time: t as Time, value: value(p) });
  }
  return out;
}
