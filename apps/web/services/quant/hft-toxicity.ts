/**
 * Guardia microstruttura: sospende ordini limit se spread > μ + σ (rolling).
 */

export type SpreadToxicityGuardOptions = {
  /** Finestra campioni spread (default 50). */
  windowSize?: number;
  /** Moltiplicatore deviazione standard (default 1). */
  sigmaMultiplier?: number;
  /** Spread minimo in bps per considerare il mercato tossico (floor). */
  minSpreadBps?: number;
};

export class SpreadToxicityGuard {
  private readonly windowSize: number;
  private readonly sigmaMultiplier: number;
  private readonly minSpreadBps: number;
  private readonly samples: number[] = [];
  private toxic = false;
  private lastReason?: string;

  constructor(opts: SpreadToxicityGuardOptions = {}) {
    this.windowSize = opts.windowSize ?? 50;
    this.sigmaMultiplier = opts.sigmaMultiplier ?? 1;
    this.minSpreadBps = opts.minSpreadBps ?? 0;
  }

  isToxic(): boolean {
    return this.toxic;
  }

  haltReason(): string | undefined {
    return this.lastReason;
  }

  /** Registra spread in bps (bid-ask / mid × 10_000). */
  observeSpreadBps(spreadBps: number): void {
    if (!Number.isFinite(spreadBps) || spreadBps < 0) return;
    this.samples.push(spreadBps);
    if (this.samples.length > this.windowSize) this.samples.shift();

    if (this.samples.length < 8) {
      this.toxic = spreadBps >= this.minSpreadBps && this.minSpreadBps > 0;
      return;
    }

    const mean = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    const variance =
      this.samples.reduce((s, x) => s + (x - mean) ** 2, 0) / this.samples.length;
    const std = Math.sqrt(variance);
    // Spread costante (es. mock sintetico): evita halt per rumore floating-point.
    if (std < 0.05) {
      this.toxic = spreadBps > mean * 1.35 + 0.5;
      if (this.toxic) {
        this.lastReason = `spread ${spreadBps.toFixed(2)}bps > baseline ${mean.toFixed(2)}bps (+35%)`;
      } else {
        this.lastReason = undefined;
      }
      return;
    }
    const threshold = mean + this.sigmaMultiplier * std;
    const floor = Math.max(this.minSpreadBps, threshold);

    if (spreadBps > floor + 0.05) {
      this.toxic = true;
      this.lastReason = `spread ${spreadBps.toFixed(2)}bps > μ+${this.sigmaMultiplier}σ (${floor.toFixed(2)}bps)`;
    } else {
      this.toxic = false;
      this.lastReason = undefined;
    }
  }

  reset(): void {
    this.samples.length = 0;
    this.toxic = false;
    this.lastReason = undefined;
  }
}

export function spreadBpsFromBook(bestBid: number, bestAsk: number): number {
  if (bestBid <= 0 || bestAsk <= 0 || bestAsk < bestBid) return 0;
  const mid = (bestBid + bestAsk) / 2;
  return ((bestAsk - bestBid) / mid) * 10_000;
}
