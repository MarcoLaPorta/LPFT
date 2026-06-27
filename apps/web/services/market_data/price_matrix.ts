import { MarketDataError } from "./errors";
import type { AdjCloseBar, PriceMatrix } from "./types";

const REGULATED_SESSION_PROXIES = ["QQQ", "SPY", "^GSPC", "^SPX", "IWM", "DIA"] as const;
const CRYPTO_TICKER_PREFIXES = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX"] as const;

/** Unisce le date uniche di tutti i simboli e ordina cronologicamente. */
export function buildMasterCalendar(seriesBySymbol: Record<string, AdjCloseBar[]>): string[] {
  const dates = new Set<string>();
  for (const bars of Object.values(seriesBySymbol)) {
    for (const b of bars) dates.add(b.date);
  }
  return [...dates].sort((a, b) => a.localeCompare(b));
}

/**
 * Forward-fill: se un asset non ha barra al giorno D, replica l'ultimo adjClose noto.
 * Nessuna interpolazione lineare. La prima osservazione mancante resta NaN finché non c'è un prezzo seed.
 */
export function alignSeriesToCalendar(
  bars: AdjCloseBar[],
  calendar: string[],
): number[] {
  const byDate = new Map(bars.map((b) => [b.date, b.adjClose]));
  const out: number[] = [];
  let last: number | null = null;
  for (const d of calendar) {
    const px = byDate.get(d);
    if (px != null && Number.isFinite(px)) last = px;
    out.push(last ?? NaN);
  }
  return out;
}

export function buildPriceMatrix(seriesBySymbol: Record<string, AdjCloseBar[]>): PriceMatrix {
  const symbols = Object.keys(seriesBySymbol).sort();
  const calendar = buildMasterCalendar(seriesBySymbol);
  const prices: Record<string, number[]> = {};
  for (const sym of symbols) {
    prices[sym] = alignSeriesToCalendar(seriesBySymbol[sym] ?? [], calendar);
  }
  return { calendar, symbols, prices };
}

/** Righe asset/benchmark per API legacy (inner join implicito via matrice densa). */
export function priceMatrixToAlignedRows(
  matrix: PriceMatrix,
  assetSymbol: string,
  benchmarkSymbol: string,
): { date: string; assetClose: number; benchClose: number }[] {
  const a = matrix.prices[assetSymbol];
  const b = matrix.prices[benchmarkSymbol];
  if (!a || !b) return [];
  const rows: { date: string; assetClose: number; benchClose: number }[] = [];
  for (let i = 0; i < matrix.calendar.length; i++) {
    const ac = a[i];
    const bc = b[i];
    if (Number.isFinite(ac) && Number.isFinite(bc) && ac > 0 && bc > 0) {
      rows.push({ date: matrix.calendar[i], assetClose: ac, benchClose: bc });
    }
  }
  return rows;
}

/** Filtra il calendario alle date in cui tutti i simboli richiesti hanno prezzi validi. */
export function trimMatrixToValidRange(matrix: PriceMatrix, requiredSymbols: string[]): PriceMatrix {
  const n = matrix.calendar.length;
  let start = 0;
  let end = n - 1;
  const hasAll = (i: number) =>
    requiredSymbols.every((s) => {
      const px = matrix.prices[s]?.[i];
      return px != null && Number.isFinite(px) && px > 0;
    });
  while (start < n && !hasAll(start)) start++;
  while (end >= start && !hasAll(end)) end--;
  if (start > end) {
    return { calendar: [], symbols: matrix.symbols, prices: Object.fromEntries(matrix.symbols.map((s) => [s, []])) };
  }
  const calendar = matrix.calendar.slice(start, end + 1);
  const prices: Record<string, number[]> = {};
  for (const s of matrix.symbols) {
    prices[s] = matrix.prices[s].slice(start, end + 1);
  }
  return { calendar, symbols: matrix.symbols, prices };
}

/**
 * Blocca il backtest se l'allineamento è vuoto o troppo corto (evita "silent failure" a 2–3 punti).
 */
export function assertPriceMatrixReady(
  matrix: PriceMatrix,
  requiredSymbols: string[],
  minCalendarDays: number,
): void {
  const syms = requiredSymbols.map((s) => s.toUpperCase());
  const reallyMissing = syms.filter((s) => !matrix.prices[s]);
  if (reallyMissing.length > 0) {
    throw new MarketDataError(
      "SYMBOL_MISSING_FROM_MATRIX",
      `Simboli assenti dalla matrice prezzi: ${reallyMissing.join(", ")}`,
      { missing: reallyMissing, available: matrix.symbols },
    );
  }

  if (matrix.calendar.length === 0) {
    throw new MarketDataError(
      "MATRIX_EMPTY",
      `Allineamento master calendar vuoto dopo forward-fill. Nessuna data comune con prezzi validi per: ${syms.join(", ")}. Verificare i ticker Yahoo (RWA vs crypto) e il range richiesto.`,
      { requiredSymbols: syms, symbols: matrix.symbols },
    );
  }

  if (matrix.calendar.length < minCalendarDays) {
    const coverage: Record<string, number> = {};
    for (const s of syms) {
      const series = matrix.prices[s] ?? [];
      coverage[s] = series.filter((px) => Number.isFinite(px) && px > 0).length;
    }
    throw new MarketDataError(
      "MATRIX_INSUFFICIENT_DAYS",
      `Calendario allineato troppo corto: ${matrix.calendar.length} giorni (minimo ${minCalendarDays}). Probabile overlap insufficiente tra asset nell'universo — il motore non può simulare 2 anni su 3 barre.`,
      {
        calendarDays: matrix.calendar.length,
        minCalendarDays,
        firstDate: matrix.calendar[0],
        lastDate: matrix.calendar[matrix.calendar.length - 1],
        validPriceCounts: coverage,
      },
    );
  }
}

/** Proxy per sessioni regolamentate (esclude giorni flat da forward-fill weekend). */
export function resolveRegulatedSessionProxy(
  matrix: PriceMatrix,
  prefer?: string,
): string | null {
  const candidates: string[] = [];
  if (prefer) candidates.push(prefer.toUpperCase());
  for (const sym of REGULATED_SESSION_PROXIES) {
    if (matrix.prices[sym]) candidates.push(sym);
  }
  for (const sym of matrix.symbols) {
    const u = sym.toUpperCase();
    if (!u.includes("-USD") && !/^(BTC|ETH|SOL)/.test(u)) candidates.push(u);
  }
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (matrix.prices[c]) return c;
  }
  return matrix.symbols[0] ?? null;
}

function isCryptoLikeSymbol(symbol: string): boolean {
  const u = symbol.toUpperCase();
  return (
    u.endsWith("-USD") ||
    u.endsWith("/USD") ||
    u === "BTC" ||
    u === "ETH" ||
    u === "SOL" ||
    u === "USDC" ||
    u === "USDT" ||
    CRYPTO_TICKER_PREFIXES.some((p) => u === p || u.startsWith(`${p}-`) || u.startsWith(`${p}/`))
  );
}

function maskFromSeries(series: number[], calendarLength: number): boolean[] {
  if (!series.length) return Array.from({ length: calendarLength }, () => true);
  return series.map((px, i) => {
    if (i === 0) return true;
    const prev = series[i - 1];
    if (!Number.isFinite(px) || !Number.isFinite(prev) || prev <= 0) return false;
    return Math.abs(px / prev - 1) > 1e-10;
  });
}

/**
 * `true` se il proxy ha avuto variazione di prezzo vs il giorno precedente (sessione attiva).
 * Giorni weekend con forward-fill → `false`.
 */
export function buildActiveSessionMask(
  matrix: PriceMatrix,
  proxySymbol: string,
  targetSymbol?: string,
): boolean[] {
  const target = (targetSymbol ?? proxySymbol).toUpperCase();
  if (isCryptoLikeSymbol(target) && matrix.prices[target]) {
    return matrix.calendar.map(() => true);
  }

  const targetSeries = matrix.prices[target];
  if (targetSeries?.length) {
    return maskFromSeries(targetSeries, matrix.calendar.length);
  }

  const proxySeries = matrix.prices[proxySymbol.toUpperCase()];
  return maskFromSeries(proxySeries ?? [], matrix.calendar.length);
}

/** Unione OR dei mask per simbolo (almeno un mercato realmente attivo nel giorno). */
export function buildCombinedActiveSessionMask(
  matrix: PriceMatrix,
  proxySymbol: string,
  symbols: string[],
): boolean[] {
  const tracked = symbols
    .map((s) => s.toUpperCase())
    .filter((s, i, arr) => Boolean(matrix.prices[s]) && arr.indexOf(s) === i);
  if (tracked.length === 0) {
    return buildActiveSessionMask(matrix, proxySymbol);
  }
  const masks = tracked.map((s) => buildActiveSessionMask(matrix, proxySymbol, s));
  return matrix.calendar.map((_, i) => masks.some((m) => Boolean(m[i])));
}

/** Stima giorni di trading annuali dalla densità di sessioni attive nel campione. */
export function estimateTradingDaysPerYear(
  activeMask: boolean[],
  calendarDays: number,
): number {
  const activeCount = activeMask.filter(Boolean).length;
  if (activeCount < 2 || calendarDays < 2) return 252;
  const years = calendarDays / 365.25;
  const estimated = Math.round(activeCount / years);
  return Math.max(200, Math.min(252, estimated));
}
