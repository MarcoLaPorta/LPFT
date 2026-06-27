import type { BacktestMetrics, ForwardProjection } from "./types";

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

export type EquityMetricsOptions = {
  /**
   * Giorni con sessione di mercato attiva (prezzo proxy variato).
   * Esclude rendimenti artificiali 0% da forward-fill weekend crypto→equity.
   */
  activeSessionMask?: boolean[];
  tradingDaysPerYear?: number;
};

/**
 * CAGR / Sharpe / max drawdown su curva equity.
 * Con `activeSessionMask`, Sharpe e CAGR usano solo rendimenti su giorni di sessione attiva.
 */
export function computeMetricsFromEquity(
  equity: number[],
  options?: EquityMetricsOptions,
): BacktestMetrics {
  if (equity.length < 2) {
    return { cagr: 0, sharpe: 0, maxDrawdown: 0 };
  }

  const mask = options?.activeSessionMask;
  const tradingDaysPerYear = options?.tradingDaysPerYear ?? 252;

  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    if (mask && !mask[i]) continue;
    const r = equity[i] / equity[i - 1] - 1;
    if (!Number.isFinite(r)) continue;
    rets.push(r);
  }

  const m = mean(rets);
  const s = sampleStd(rets) || 1e-12;
  const sharpe = rets.length >= 2 ? (m / s) * Math.sqrt(tradingDaysPerYear) : 0;

  const years =
    rets.length > 0 ? rets.length / tradingDaysPerYear : (equity.length - 1) / tradingDaysPerYear;
  const cagr =
    years > 0 && equity[0] > 0
      ? (equity[equity.length - 1] / equity[0]) ** (1 / years) - 1
      : 0;

  let peak = equity[0];
  let mdd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return { cagr, sharpe, maxDrawdown: mdd };
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function projectForwardFromCloses(
  closes: number[],
  horizonDays: number,
  options?: { lookback?: number; mcPaths?: number },
): ForwardProjection {
  const lookback = options?.lookback ?? 60;
  const tail = closes.slice(-(lookback + 1));
  const logR: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    logR.push(Math.log(tail[i] / tail[i - 1]));
  }
  const m = mean(logR);
  const s = sampleStd(logR) || 1e-8;
  const H = Math.max(1, horizonDays);
  const drift = m + (s * s) / 2;
  const expectedEquityMultiple = Math.exp(H * drift);
  const z05 = -1.6448536269514722;
  const z95 = 1.6448536269514722;
  const p05EquityMultiple = Math.exp(H * m + z05 * s * Math.sqrt(H));
  const p95EquityMultiple = Math.exp(H * m + z95 * s * Math.sqrt(H));

  let mcTerminalMultiples: number[] | undefined;
  const mcPaths = options?.mcPaths;
  if (mcPaths != null && mcPaths > 0) {
    mcTerminalMultiples = [];
    for (let p = 0; p < mcPaths; p++) {
      let logL = 0;
      for (let h = 0; h < H; h++) {
        logL += m + s * gaussian();
      }
      mcTerminalMultiples.push(Math.exp(logL));
    }
  }

  return {
    horizonDays: H,
    lookbackDays: lookback,
    expectedEquityMultiple,
    p05EquityMultiple,
    p95EquityMultiple,
    mcTerminalMultiples,
  };
}
