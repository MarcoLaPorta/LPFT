import type { PriceMatrix } from "../market_data/types";

/**
 * Point-in-Time (PiT) — nasconde dati con indice > asOfIndex (anti look-ahead).
 * Tier 1 Phase 3.
 */

export class PiTLookaheadError extends Error {
  readonly code = "PIT_LOOKAHEAD_VIOLATION" as const;

  constructor(asOfIndex: number, attemptedIndex: number, symbol?: string) {
    super(
      `PiT violation: tentativo di leggere barra ${attemptedIndex} con as-of ${asOfIndex}${symbol ? ` (${symbol})` : ""}`,
    );
    this.name = "PiTLookaheadError";
  }
}

export class PiTMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PiTMatrixError";
  }
}

/** Vista matrice troncata a `asOfIndex` incluso (solo dati noti al tick di simulazione). */
export function sliceMatrixAsOf(matrix: PriceMatrix, asOfIndex: number): PriceMatrix {
  const n = matrix.calendar.length;
  if (asOfIndex < 0 || asOfIndex >= n) {
    throw new PiTMatrixError(`asOfIndex ${asOfIndex} fuori range [0, ${n - 1}]`);
  }
  const prices: Record<string, number[]> = {};
  for (const sym of matrix.symbols) {
    const series = matrix.prices[sym];
    if (!series || series.length !== n) {
      throw new PiTMatrixError(`Serie ${sym} non allineata al calendario master`);
    }
    prices[sym] = series.slice(0, asOfIndex + 1);
  }
  return {
    calendar: matrix.calendar.slice(0, asOfIndex + 1),
    symbols: [...matrix.symbols],
    prices,
  };
}

/** Prezzo con guardia esplicita (per accessi diretti fuori dal loop standard). */
export function getPiTPrice(
  matrix: PriceMatrix,
  symbol: string,
  dayIndex: number,
  asOfIndex: number,
): number {
  if (dayIndex > asOfIndex) {
    throw new PiTLookaheadError(asOfIndex, dayIndex, symbol);
  }
  const sym = symbol.toUpperCase();
  const px = matrix.prices[sym]?.[dayIndex];
  if (px == null || !Number.isFinite(px)) {
    throw new PiTMatrixError(`Prezzo assente ${sym} @ ${dayIndex}`);
  }
  return px;
}
