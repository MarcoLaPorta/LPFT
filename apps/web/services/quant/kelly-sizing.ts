import type { SimulatedTrade } from "./types";
import { tradeStatsForKelly } from "./regime-analysis";

/**
 * Kelly criterion: f* = p - (1-p)/b, b = avgWin/avgLoss.
 * Restituisce frazione [0, 1] o null se dati insufficienti.
 */
export function fullKellyFraction(
  winRate: number,
  avgWin: number,
  avgLoss: number,
): number | null {
  if (avgLoss <= 0 || !Number.isFinite(winRate)) return null;
  const b = avgWin / avgLoss;
  if (b <= 0 || !Number.isFinite(b)) return null;
  const f = winRate - (1 - winRate) / b;
  if (!Number.isFinite(f)) return null;
  return Math.max(0, Math.min(1, f));
}

export function kellyFromTrades(trades: SimulatedTrade[]): number | null {
  const stats = tradeStatsForKelly(trades);
  if (!stats) return null;
  return fullKellyFraction(stats.winRate, stats.avgWin, stats.avgLoss);
}

/**
 * Limita ogni peso target a fractionalKelly × Kelly pieno (default ¼-Kelly).
 */
export function applyFractionalKellyCap(
  targetWeights: Record<string, number>,
  trades: SimulatedTrade[],
  options?: {
    /** Moltiplicatore su Kelly pieno (0.25 = quarter-Kelly). */
    fractionalKelly?: number;
    /** Tetto assoluto se Kelly non stimabile. */
    fallbackMaxWeight?: number;
    enabled?: boolean;
  },
): Record<string, number> {
  const enabled = options?.enabled !== false;
  if (!enabled) return targetWeights;

  const frac = options?.fractionalKelly ?? 0.25;
  const fallback = options?.fallbackMaxWeight ?? 0.25;
  const full = kellyFromTrades(trades);
  const cap = full != null ? Math.max(0.01, Math.min(1, frac * full)) : fallback;

  const out: Record<string, number> = {};
  let sum = 0;
  for (const [sym, w] of Object.entries(targetWeights)) {
    const capped = Math.min(Math.max(0, w), cap);
    out[sym] = capped;
    sum += capped;
  }
  if (sum > 1 && sum > 0) {
    for (const sym of Object.keys(out)) {
      out[sym] = out[sym] / sum;
    }
  }
  return out;
}
