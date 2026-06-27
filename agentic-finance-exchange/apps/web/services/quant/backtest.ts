import type { AlignedPriceRow } from "../market_data";

export type BacktestPoint = {
  date: string;
  equity: number;
  benchmark: number;
};

export type BuyHoldStrategy = { kind: "buy_and_hold" };

/**
 * Riduce il rischio quando il portafoglio scende oltre soglia dal massimo corrente;
 * torna risk-on quando il prezzo supera la SMA dell’asset (uscita da stable sintetica a rendimento ~0).
 */
export type DrawdownToStableStrategy = {
  kind: "drawdown_to_stable";
  maxDrawdownFrac: number;
  reentrySmaDays: number;
};

export type StrategySpec = BuyHoldStrategy | DrawdownToStableStrategy;

export type BacktestMetrics = {
  cagr: number;
  sharpe: number;
  maxDrawdown: number;
};

export type ForwardProjection = {
  horizonDays: number;
  lookbackDays: number;
  /** Multiplo atteso vs ultimo valore equity (modello log-normale semplificato). */
  expectedEquityMultiple: number;
  p05EquityMultiple: number;
  p95EquityMultiple: number;
  /** Campioni terminali Monte Carlo (multipli vs 1.0 alla fine dello storico). */
  mcTerminalMultiples?: number[];
};

export type BacktestResult = {
  series: BacktestPoint[];
  metrics: BacktestMetrics;
  benchmarkMetrics: BacktestMetrics;
  projection?: ForwardProjection;
};

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

function computeMetricsFromEquity(equity: number[], tradingDaysPerYear = 252): BacktestMetrics {
  if (equity.length < 2) {
    return { cagr: 0, sharpe: 0, maxDrawdown: 0 };
  }
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    rets.push(equity[i] / equity[i - 1] - 1);
  }
  const m = mean(rets);
  const s = sampleStd(rets) || 1e-12;
  const sharpe = (m / s) * Math.sqrt(tradingDaysPerYear);
  const years = (equity.length - 1) / tradingDaysPerYear;
  const cagr = years > 0 ? (equity[equity.length - 1] / equity[0]) ** (1 / years) - 1 : 0;
  let peak = equity[0];
  let mdd = 0;
  for (const v of equity) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return { cagr, sharpe, maxDrawdown: mdd };
}

function smaAt(closes: number[], index: number, window: number): number | null {
  if (index + 1 < window) return null;
  let s = 0;
  for (let j = index - window + 1; j <= index; j++) {
    s += closes[j];
  }
  return s / window;
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Proiezione base: drift+vol stimati sugli ultimi `lookback` rendimenti log dell’asset;
 * percentili da normale su somma i.i.d.; opzionale MC.
 */
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

/**
 * Simula equity normalizzata (1.0 al primo giorno) e benchmark sulla stessa griglia di date.
 */
export function runStrategyBacktest(
  aligned: AlignedPriceRow[],
  strategy: StrategySpec,
  options?: { projectionHorizonDays?: number; projectionMcPaths?: number; projectionLookback?: number },
): BacktestResult {
  if (aligned.length < 2) {
    return {
      series: [],
      metrics: { cagr: 0, sharpe: 0, maxDrawdown: 0 },
      benchmarkMetrics: { cagr: 0, sharpe: 0, maxDrawdown: 0 },
    };
  }

  const dates = aligned.map((r) => r.date);
  const assetCloses = aligned.map((r) => r.assetClose);
  const benchCloses = aligned.map((r) => r.benchClose);

  const series: BacktestPoint[] = [];
  let equity = 1;
  let bench = 1;
  let peak = 1;
  let inAsset = true;

  series.push({ date: dates[0], equity, benchmark: bench });

  for (let i = 1; i < aligned.length; i++) {
    const rAsset = assetCloses[i] / assetCloses[i - 1] - 1;
    const rBench = benchCloses[i] / benchCloses[i - 1] - 1;

    if (strategy.kind === "buy_and_hold") {
      equity *= 1 + rAsset;
      bench *= 1 + rBench;
    } else {
      const sma = smaAt(assetCloses, i, strategy.reentrySmaDays);
      if (inAsset) {
        equity *= 1 + rAsset;
        peak = Math.max(peak, equity);
        const dd = equity / peak - 1;
        if (dd <= -strategy.maxDrawdownFrac) {
          inAsset = false;
        }
      } else {
        // stable sintetica: rendimento nominale ~0
        if (sma != null && assetCloses[i] > sma) {
          inAsset = true;
          peak = equity;
        }
      }
      bench *= 1 + rBench;
    }

    series.push({ date: dates[i], equity, benchmark: bench });
  }

  const eq = series.map((p) => p.equity);
  const bm = series.map((p) => p.benchmark);
  const metrics = computeMetricsFromEquity(eq);
  const benchmarkMetrics = computeMetricsFromEquity(bm);

  let projection: ForwardProjection | undefined;
  const H = options?.projectionHorizonDays;
  if (H != null && H > 0) {
    projection = projectForwardFromCloses(assetCloses, H, {
      lookback: options?.projectionLookback,
      mcPaths: options?.projectionMcPaths,
    });
  }

  return { series, metrics, benchmarkMetrics, projection };
}
