import type { BacktestPointView } from "./afx-analysis-types";
import { backtestPointUnixSec, toAscChartLineData } from "./chart-time";
import { fmtPctFrac } from "./afx-derived-stats";
import type { SimulatedTrade } from "../services/quant/backtest";
import type { Time } from "lightweight-charts";

export type ChartPoint = { time: Time; value: number };

export type MonthlyReturnRow = {
  month: string;
  strat: number;
  bench: number;
  alpha: number;
};

export type PeriodReturnRow = {
  label: string;
  strat: number;
  bench: number;
  alpha: number;
};

export type AdvancedMetrics = {
  calmar: number | null;
  sortino: number | null;
  beta: number | null;
  correlation: number | null;
  trackingError: number | null;
  informationRatio: number | null;
  upCapture: number | null;
  downCapture: number | null;
};

function dailyReturns(series: BacktestPointView[]): { strat: number[]; bench: number[] } {
  const strat: number[] = [];
  const bench: number[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    if (prev.equity > 0) strat.push(cur.equity / prev.equity - 1);
    if (prev.benchmark > 0) bench.push(cur.benchmark / prev.benchmark - 1);
  }
  return { strat, bench };
}

export function drawdownSeries(series: BacktestPointView[]): ChartPoint[] {
  if (series.length < 2) return [];
  let peak = series[0].equity;
  return toAscChartLineData(series, (p) => {
    if (p.equity > peak) peak = p.equity;
    return p.equity / peak - 1;
  });
}

export function relativeStrengthSeries(series: BacktestPointView[]): ChartPoint[] {
  if (series.length < 2) return [];
  const base = series[0].benchmark > 0 ? series[0].equity / series[0].benchmark : 1;
  return toAscChartLineData(series, (p) =>
    p.benchmark > 0 ? p.equity / p.benchmark / base : 1,
  );
}

export function rollingVolatilitySeries(
  series: BacktestPointView[],
  window = 21,
): { strat: ChartPoint[]; bench: ChartPoint[] } {
  const strat: ChartPoint[] = [];
  const bench: ChartPoint[] = [];
  if (series.length <= window) return { strat, bench };

  const rets = dailyReturns(series);
  const used = new Set<number>();
  for (let i = window - 1; i < rets.strat.length; i++) {
    const sSlice = rets.strat.slice(i - window + 1, i + 1);
    const bSlice = rets.bench.slice(i - window + 1, i + 1);
    const sm = sSlice.reduce((a, b) => a + b, 0) / window;
    const bm = bSlice.reduce((a, b) => a + b, 0) / window;
    const sv = Math.sqrt(
      sSlice.reduce((s, x) => s + (x - sm) ** 2, 0) / Math.max(1, window - 1),
    );
    const bv = Math.sqrt(
      bSlice.reduce((s, x) => s + (x - bm) ** 2, 0) / Math.max(1, window - 1),
    );
    let t = backtestPointUnixSec(series[i + 1]);
    while (used.has(t)) t += 1;
    used.add(t);
    const time = t as Time;
    strat.push({ time, value: sv * Math.sqrt(252) });
    bench.push({ time, value: bv * Math.sqrt(252) });
  }
  return { strat, bench };
}

export function monthlyReturns(series: BacktestPointView[]): MonthlyReturnRow[] {
  if (series.length < 2) return [];
  const buckets = new Map<string, { s0: number; s1: number; b0: number; b1: number }>();
  for (const p of series) {
    const month = p.date.slice(0, 7);
    const cur = buckets.get(month);
    if (!cur) buckets.set(month, { s0: p.equity, s1: p.equity, b0: p.benchmark, b1: p.benchmark });
    else {
      cur.s1 = p.equity;
      cur.b1 = p.benchmark;
    }
  }
  return [...buckets.entries()].map(([month, v]) => {
    const strat = v.s0 > 0 ? v.s1 / v.s0 - 1 : 0;
    const bench = v.b0 > 0 ? v.b1 / v.b0 - 1 : 0;
    return { month, strat, bench, alpha: strat - bench };
  });
}

export function periodReturns(series: BacktestPointView[]): PeriodReturnRow[] {
  if (series.length < 2) return [];
  const last = series[series.length - 1];
  const labels: { label: string; bars: number }[] = [
    { label: "1 mese", bars: 21 },
    { label: "3 mesi", bars: 63 },
    { label: "6 mesi", bars: 126 },
    { label: "1 anno", bars: 252 },
    { label: "Intero periodo", bars: series.length - 1 },
  ];

  return labels
    .filter((x) => x.bars < series.length)
    .map(({ label, bars }) => {
      const start = series[series.length - 1 - bars];
      const strat = start.equity > 0 ? last.equity / start.equity - 1 : 0;
      const bench = start.benchmark > 0 ? last.benchmark / start.benchmark - 1 : 0;
      return { label, strat, bench, alpha: strat - bench };
    });
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function cov(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  return a.slice(0, n).reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (n - 1);
}

export function computeAdvancedMetrics(
  series: BacktestPointView[],
  cagr: number | undefined,
  maxDd: number | undefined,
): AdvancedMetrics {
  const rets = dailyReturns(series);
  const n = rets.strat.length;
  if (n < 5) {
    return {
      calmar: null,
      sortino: null,
      beta: null,
      correlation: null,
      trackingError: null,
      informationRatio: null,
      upCapture: null,
      downCapture: null,
    };
  }

  const downside = rets.strat.filter((r) => r < 0);
  const downDev = downside.length
    ? Math.sqrt(downside.reduce((s, r) => s + r ** 2, 0) / downside.length)
    : 0;
  const annDown = downDev * Math.sqrt(252);
  const sortino = annDown > 0 && cagr != null ? cagr / annDown : null;
  const calmar =
    maxDd != null && maxDd < 0 && cagr != null ? cagr / Math.abs(maxDd) : null;

  const varB = cov(rets.bench, rets.bench);
  const beta = varB > 0 ? cov(rets.strat, rets.bench) / varB : null;
  const corr =
    std(rets.strat) > 0 && std(rets.bench) > 0
      ? cov(rets.strat, rets.bench) / (std(rets.strat) * std(rets.bench))
      : null;

  const active = rets.strat.map((r, i) => r - rets.bench[i]);
  const te = std(active) * Math.sqrt(252);
  const ir = te > 0 && cagr != null ? mean(active) * 252 / te : null;

  const upIdx = rets.bench.map((r, i) => (r > 0 ? i : -1)).filter((i) => i >= 0);
  const downIdx = rets.bench.map((r, i) => (r < 0 ? i : -1)).filter((i) => i >= 0);
  const upCapture =
    upIdx.length > 0
      ? mean(upIdx.map((i) => rets.strat[i])) / mean(upIdx.map((i) => rets.bench[i]))
      : null;
  const downCapture =
    downIdx.length > 0
      ? mean(downIdx.map((i) => rets.strat[i])) / mean(downIdx.map((i) => rets.bench[i]))
      : null;

  return {
    calmar,
    sortino,
    beta,
    correlation: corr,
    trackingError: te,
    informationRatio: ir,
    upCapture: Number.isFinite(upCapture ?? NaN) ? upCapture : null,
    downCapture: Number.isFinite(downCapture ?? NaN) ? downCapture : null,
  };
}

export function tradePnlBuckets(trades: SimulatedTrade[]): { label: string; count: number }[] {
  const bins = [
    { label: "< -5%", min: -Infinity, max: -0.05 },
    { label: "-5% … 0%", min: -0.05, max: 0 },
    { label: "0% … 5%", min: 0, max: 0.05 },
    { label: "> 5%", min: 0.05, max: Infinity },
  ];
  return bins.map((b) => ({
    label: b.label,
    count: trades.filter((t) => t.pnlFrac > b.min && t.pnlFrac <= b.max).length,
  }));
}

const ADVANCED_LABELS: Record<keyof AdvancedMetrics, string> = {
  calmar: "Calmar",
  sortino: "Sortino",
  beta: "Beta",
  correlation: "Correlazione",
  trackingError: "Tracking error",
  informationRatio: "Info ratio",
  upCapture: "Up capture",
  downCapture: "Down capture",
};

export function advancedMetricLabel(key: keyof AdvancedMetrics) {
  return ADVANCED_LABELS[key];
}

export function formatAdvancedMetric(
  key: keyof AdvancedMetrics,
  v: number | null,
): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (key === "beta" || key === "correlation" || key === "calmar" || key === "sortino" || key === "informationRatio")
    return v.toFixed(2);
  if (key === "upCapture" || key === "downCapture") return v.toFixed(2);
  return fmtPctFrac(v);
}
