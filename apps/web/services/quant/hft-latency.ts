/**
 * Jitter di latenza esecuzione — distribuzione Gamma (media ~25ms Tier 1).
 */

export type GammaLatencyOptions = {
  /** Media in ms (default 25). */
  meanMs?: number;
  /** Parametro forma k (default 2). */
  shapeK?: number;
};

/** Campionamento Gamma(k, θ) con θ = mean/k. */
export function sampleGammaLatencyMs(opts: GammaLatencyOptions = {}): number {
  const mean = opts.meanMs ?? 25;
  const k = opts.shapeK ?? 2;
  const theta = mean / k;
  return sampleGamma(k, theta);
}

function sampleGamma(shape: number, scale: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1, scale) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      const u1 = Math.random();
      const u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      x = z;
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}
