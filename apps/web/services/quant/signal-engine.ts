import type { EventDrivenStrategyConfig, RebalanceFrequency } from "./types";
import type { PriceMatrix } from "../market_data/types";

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function smaAt(series: number[], index: number, window: number): number | null {
  if (index + 1 < window) return null;
  let s = 0;
  for (let j = index - window + 1; j <= index; j++) s += series[j];
  return s / window;
}

function rsiAt(series: number[], index: number, period: number): number | null {
  if (index < period) return null;
  let gains = 0;
  let losses = 0;
  for (let j = index - period + 1; j <= index; j++) {
    const ch = series[j] - series[j - 1];
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

function zScoreAt(series: number[], index: number, lookback: number): number | null {
  if (index + 1 < lookback) return null;
  const slice = series.slice(index - lookback + 1, index + 1);
  const m = mean(slice);
  const s = sampleStd(slice) || 1e-12;
  return (series[index] - m) / s;
}

function rocAt(series: number[], index: number, lookback: number): number | null {
  if (index < lookback) return null;
  const prev = series[index - lookback];
  if (prev <= 0) return null;
  return series[index] / prev - 1;
}

/** EMA al bar `index` (seed = SMA dei primi `period` prezzi). */
export function emaAt(series: number[], index: number, period: number): number | null {
  if (index + 1 < period || period < 1) return null;
  const k = 2 / (period + 1);
  let ema = 0;
  for (let j = 0; j < period; j++) {
    const px = series[j];
    if (!Number.isFinite(px)) return null;
    ema += px;
  }
  ema /= period;
  for (let j = period; j <= index; j++) {
    const px = series[j];
    if (!Number.isFinite(px)) return null;
    ema = px * k + ema * (1 - k);
  }
  return ema;
}

export type AsymmetricTrendMomentumConfig = {
  lookbackPeriodDays: number;
  equitySmaPeriod: number;
  cryptoEmaPeriod: number;
  equityTicker: string;
  cryptoTicker: string;
  safeHavenTicker: string;
};

function resolveMatrixSymbol(matrix: PriceMatrix, ticker: string): string | null {
  const t = ticker.toUpperCase();
  if (matrix.prices[t]) return t;
  const alt = t.replace(/\./g, "-");
  if (matrix.prices[alt]) return alt;
  return null;
}

function passesAsymmetricTrendFilter(
  symKey: string,
  role: "equity" | "crypto",
  series: number[],
  dayIndex: number,
  cfg: AsymmetricTrendMomentumConfig,
): boolean {
  const px = series[dayIndex];
  if (!Number.isFinite(px) || px <= 0) return false;
  if (role === "equity") {
    const sma = smaAt(series, dayIndex, cfg.equitySmaPeriod);
    return sma != null && px > sma;
  }
  const ema = emaAt(series, dayIndex, cfg.cryptoEmaPeriod);
  return ema != null && px > ema;
}

/**
 * ASYMMETRIC_TREND_MOMENTUM: momentum 90d QQQ vs BTC, filtro SMA/EMA, fallback GLD.
 * Restituisce il ticker da allocare al 100% o null (cash) se dati insufficienti.
 */
export function pickAsymmetricTrendMomentumTarget(
  matrix: PriceMatrix,
  dayIndex: number,
  cfg: AsymmetricTrendMomentumConfig,
): string | null {
  const equityKey = resolveMatrixSymbol(matrix, cfg.equityTicker);
  const cryptoKey = resolveMatrixSymbol(matrix, cfg.cryptoTicker);
  const safeKey = resolveMatrixSymbol(matrix, cfg.safeHavenTicker);
  if (!equityKey || !cryptoKey || !safeKey) return null;

  const eqSeries = matrix.prices[equityKey];
  const btcSeries = matrix.prices[cryptoKey];
  if (!eqSeries || !btcSeries) return null;

  const lb = cfg.lookbackPeriodDays;
  const rocQ = rocAt(eqSeries, dayIndex, lb);
  const rocB = rocAt(btcSeries, dayIndex, lb);
  if (rocQ == null || rocB == null) return null;

  const leader = rocQ >= rocB ? equityKey : cryptoKey;
  const runnerUp = leader === equityKey ? cryptoKey : equityKey;
  const leaderRole = leader === equityKey ? "equity" : "crypto";
  const runnerRole = runnerUp === equityKey ? "equity" : "crypto";
  const leaderSeries = leader === equityKey ? eqSeries : btcSeries;
  const runnerSeries = runnerUp === equityKey ? eqSeries : btcSeries;

  if (passesAsymmetricTrendFilter(leader, leaderRole, leaderSeries, dayIndex, cfg)) {
    return leader;
  }
  if (passesAsymmetricTrendFilter(runnerUp, runnerRole, runnerSeries, dayIndex, cfg)) {
    return runnerUp;
  }

  return safeKey;
}

export function computeAsymmetricTrendMomentumWeights(
  matrix: PriceMatrix,
  dayIndex: number,
  universe: string[],
  cfg: AsymmetricTrendMomentumConfig,
): Record<string, number> {
  const keys = new Set(universe.map((s) => s.toUpperCase()));
  for (const t of [cfg.equityTicker, cfg.cryptoTicker, cfg.safeHavenTicker]) {
    const k = resolveMatrixSymbol(matrix, t);
    if (k) keys.add(k);
  }
  const weights: Record<string, number> = {};
  for (const s of keys) weights[s] = 0;

  const target = pickAsymmetricTrendMomentumTarget(matrix, dayIndex, cfg);
  if (target) weights[target] = 1;
  return weights;
}

export function isRebalanceDay(
  calendar: string[],
  dayIndex: number,
  frequency: RebalanceFrequency,
): boolean {
  if (frequency === "NONE" || frequency === "DAILY_SIGNAL") return frequency === "DAILY_SIGNAL";
  const d = calendar[dayIndex];
  const prev = dayIndex > 0 ? calendar[dayIndex - 1] : null;
  if (!prev) return false;
  const [y, m] = d.split("-").map(Number);
  const [py, pm] = prev.split("-").map(Number);
  if (frequency === "MONTHLY") return m !== pm || y !== py;
  if (frequency === "QUARTERLY") {
    const q = Math.floor((m - 1) / 3);
    const pq = Math.floor((pm - 1) / 3);
    return q !== pq || y !== py;
  }
  return false;
}

/** Pesi target 0–1 per simbolo (somma ≤ 1, resto implicitamente cash). */
export function computeTargetWeights(
  matrix: PriceMatrix,
  dayIndex: number,
  config: EventDrivenStrategyConfig,
): Record<string, number> {
  const tag = config.sourceSignal;
  const sig = config.signal.kind;
  const primary = config.primaryTicker.toUpperCase();
  const universe = config.universe.map((s) => s.toUpperCase());
  const weights: Record<string, number> = {};
  const zero = () => universe.forEach((s) => (weights[s] = 0));

  if (sig === "buy_and_hold") {
    zero();
    weights[primary] = 1;
    return weights;
  }

  if (sig === "dual_momentum") {
    const lb = config.signal.dualMomentumLookback ?? 90;
    let best: string | null = null;
    let bestRoc = -Infinity;
    for (const sym of universe) {
      const series = matrix.prices[sym];
      if (!series) continue;
      const r = rocAt(series, dayIndex, lb);
      if (r == null) continue;
      if (r > bestRoc) {
        bestRoc = r;
        best = sym;
      }
    }
    zero();
    if (best != null && bestRoc > 0) {
      weights[best] = 1;
    }
    return weights;
  }

  if (sig === "asymmetric_trend_momentum" && config.signal.asymmetricTrendMomentum) {
    return computeAsymmetricTrendMomentumWeights(
      matrix,
      dayIndex,
      universe,
      config.signal.asymmetricTrendMomentum,
    );
  }

  const series = matrix.prices[primary];
  if (!series) {
    zero();
    return weights;
  }

  if (sig === "sma_crossover") {
    const f = smaAt(series, dayIndex, config.signal.smaFast ?? 20);
    const s = smaAt(series, dayIndex, config.signal.smaSlow ?? 50);
    zero();
    if (f != null && s != null && f > s) weights[primary] = 1;
    return weights;
  }

  if (sig === "rsi") {
    const rsi = rsiAt(series, dayIndex, config.signal.rsiPeriod ?? 14);
    zero();
    if (rsi != null && rsi < (config.signal.rsiOversold ?? 30)) weights[primary] = 1;
    else if (rsi != null && rsi > (config.signal.rsiOverbought ?? 70)) weights[primary] = 0;
    else {
      /* mantieni stato implicito: se non trigger, non forzare — gestito da execution con pesi precedenti */
    }
    return weights;
  }

  if (sig === "z_score") {
    const z = zScoreAt(series, dayIndex, config.signal.zLookback ?? 20);
    zero();
    if (z != null && z <= (config.signal.zEntry ?? -2)) weights[primary] = 1;
    if (z != null && z >= (config.signal.zExit ?? 0)) weights[primary] = 0;
    return weights;
  }

  if (sig === "macro_allocation") {
    const smaDays = config.signal.reentrySmaDays ?? 21;
    const sma = smaAt(series, dayIndex, smaDays);
    zero();
    if (sma != null && series[dayIndex] > sma) weights[primary] = 1;
    return weights;
  }

  if (sig === "alternating") {
    zero();
    if (dayIndex % 2 === 0) weights[primary] = 1;
    return weights;
  }

  zero();
  weights[primary] = 1;
  return weights;
}

export function formatTargetReason(
  config: EventDrivenStrategyConfig,
  weights: Record<string, number>,
): string {
  const tag = config.sourceSignal;
  const held = Object.entries(weights).filter(([, w]) => w > 0.001);
  if (held.length === 0) return `${tag}:ALLOCATE_CASH`;
  const parts = held.map(([s, w]) => `${s}@${(w * 100).toFixed(0)}%`);
  return `${tag}:REBALANCE(${parts.join(",")})`;
}
