import type { BacktestPoint } from "../services/quant/backtest";
import type { BacktestMetricsView, DerivedBacktestStats } from "./afx-analysis-types";

export function computeDerivedBacktestStats(series: BacktestPoint[]): DerivedBacktestStats | undefined {
  if (series.length < 2) return undefined;
  const first = series[0];
  const last = series[series.length - 1];
  const totalReturn = last.equity / first.equity - 1;
  const benchmarkTotalReturn = last.benchmark / first.benchmark - 1;
  return {
    totalReturn,
    benchmarkTotalReturn,
    alphaVsBenchmark: totalReturn - benchmarkTotalReturn,
    finalEquity: last.equity,
    finalBenchmark: last.benchmark,
    barCount: series.length,
    firstDate: first.date,
    lastDate: last.date,
  };
}

export function annualizedVolFromSeries(series: BacktestPoint[]): number {
  if (series.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < series.length; i++) {
    rets.push(series[i].equity / series[i - 1].equity - 1);
  }
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v =
    rets.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, rets.length - 1);
  return Math.sqrt(v) * Math.sqrt(252);
}

export function fmtPctFrac(x: number, digits = 2) {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtMultiple(x: number) {
  if (!Number.isFinite(x)) return "—";
  return `${x.toFixed(3)}×`;
}

export function metricsRows(
  label: string,
  m: BacktestMetricsView | undefined,
): { label: string; value: string }[] {
  if (!m) return [];
  return [
    { label: `${label} CAGR`, value: fmtPctFrac(m.cagr) },
    { label: `${label} Sharpe`, value: m.sharpe.toFixed(2) },
    { label: `${label} Max DD`, value: fmtPctFrac(m.maxDrawdown, 1) },
  ];
}
