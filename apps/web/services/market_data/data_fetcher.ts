import YahooFinance from "yahoo-finance2";
import { prisma } from "../../lib/prisma";
import { fetchAlpacaHistoricalBars } from "./alpaca-historical";
import { getAlpacaConfig } from "./alpaca-config";
import { MarketDataError } from "./errors";
import { resolveHistoricalProvider, type MarketDataProvider } from "./router";
import type { AdjCloseBar, FetchHistoryOptions } from "./types";

const yahooFinance = new YahooFinance();

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Giorni di calendario → soglia minima barre (~55% sessioni). */
export function minBarsForDateRange(period1: Date, period2: Date, floor = 20): number {
  const spanDays = Math.max(1, (period2.getTime() - period1.getTime()) / 86_400_000);
  return Math.max(floor, Math.floor(spanDays * 0.55));
}

function isHistoryRow(
  r: unknown,
): r is { date: Date; adjClose?: number; close: number; volume?: number } {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return o.date instanceof Date && typeof o.close === "number";
}

/** Yahoo: solo adjClose (obbligatorio per il motore). */
async function fetchFromYahoo(symbol: string, opts: FetchHistoryOptions): Promise<AdjCloseBar[]> {
  const sym = symbol.toUpperCase();
  let raw: unknown;
  try {
    raw = await yahooFinance.historical(sym, {
      period1: opts.period1,
      period2: opts.period2,
      interval: opts.interval ?? "1d",
    });
  } catch (cause) {
    throw new MarketDataError(
      "TICKER_FETCH_FAILED",
      `Download Yahoo fallito per ${sym}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { symbol: sym, period1: dateKey(opts.period1), period2: dateKey(opts.period2) },
    );
  }

  if (!Array.isArray(raw)) {
    throw new MarketDataError(
      "TICKER_FETCH_FAILED",
      `Yahoo historical: risposta non valida per ${sym}`,
      { symbol: sym },
    );
  }

  const bars: AdjCloseBar[] = [];
  for (const r of raw) {
    if (!isHistoryRow(r)) continue;
    const adj = r.adjClose;
    if (adj == null || !Number.isFinite(adj)) {
      throw new MarketDataError(
        "TICKER_FETCH_FAILED",
        `Yahoo historical: adjClose mancante per ${sym} @ ${dateKey(r.date)} — non usare close grezzo`,
        { symbol: sym, date: dateKey(r.date) },
      );
    }
    bars.push({
      date: dateKey(r.date),
      adjClose: adj,
      volume: typeof r.volume === "number" ? r.volume : 0,
    });
  }
  return bars.sort((a, b) => a.date.localeCompare(b.date));
}

async function loadBarsFromDb(
  symbol: string,
  period1: Date,
  period2: Date,
): Promise<
  Array<{
    date: Date;
    adjClose: number;
    volume: number;
    fetchedAt: Date;
  }>
> {
  const rows = await prisma.marketDataBar.findMany({
    where: {
      symbol: symbol.toUpperCase(),
      date: { gte: period1, lte: period2 },
    },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date,
    adjClose: Number(r.adjClose),
    volume: r.volume != null ? Number(r.volume) : 0,
    fetchedAt: r.fetchedAt,
  }));
}

async function persistBarsToDb(
  symbol: string,
  bars: AdjCloseBar[],
  source: MarketDataProvider = "yahoo",
): Promise<void> {
  const sym = symbol.toUpperCase();
  const chunk = 200;
  for (let i = 0; i < bars.length; i += chunk) {
    const slice = bars.slice(i, i + chunk);
    await prisma.$transaction(
      slice.map((b) =>
        prisma.marketDataBar.upsert({
          where: {
            symbol_date: { symbol: sym, date: new Date(`${b.date}T00:00:00.000Z`) },
          },
          create: {
            symbol: sym,
            date: new Date(`${b.date}T00:00:00.000Z`),
            adjClose: b.adjClose,
            volume: b.volume,
            source,
          },
          update: {
            adjClose: b.adjClose,
            volume: b.volume,
            fetchedAt: new Date(),
          },
        }),
      ),
    );
  }
}

function coversRange(bars: AdjCloseBar[], period1: Date, period2: Date, minBars: number): boolean {
  if (bars.length < minBars) return false;
  const p1 = dateKey(period1);
  const p2 = dateKey(period2);
  return bars[0].date <= p1 && bars[bars.length - 1].date >= p2;
}

function isFreshEnough(
  bars: Array<{ fetchedAt: Date }>,
  maxAgeMs = 24 * 60 * 60 * 1000,
): boolean {
  if (bars.length === 0) return false;
  const threshold = Date.now() - maxAgeMs;
  return bars.every((bar) => bar.fetchedAt.getTime() >= threshold);
}

function assertTickerSeries(
  symbol: string,
  bars: AdjCloseBar[],
  opts: FetchHistoryOptions,
): void {
  const minBars = minBarsForDateRange(opts.period1, opts.period2);
  if (bars.length === 0) {
    throw new MarketDataError(
      "TICKER_EMPTY_SERIES",
      `Nessuna barra storica per ${symbol} tra ${dateKey(opts.period1)} e ${dateKey(opts.period2)}`,
      { symbol, period1: dateKey(opts.period1), period2: dateKey(opts.period2) },
    );
  }
  if (bars.length < minBars) {
    throw new MarketDataError(
      "TICKER_INSUFFICIENT_BARS",
      `Serie troppo corta per ${symbol}: ${bars.length} barre (minimo ${minBars})`,
      {
        symbol,
        barCount: bars.length,
        minBars,
        firstDate: bars[0].date,
        lastDate: bars[bars.length - 1].date,
      },
    );
  }
}

/**
 * Carica serie storiche: cache Prisma prima, Yahoo se assente o incompleta.
 * Restituisce SOLO adjClose. Lancia MarketDataError se dati assenti o insufficienti.
 */
export async function fetchAdjCloseHistory(
  symbol: string,
  opts: FetchHistoryOptions,
): Promise<AdjCloseBar[]> {
  const sym = symbol.toUpperCase();
  const minBars = minBarsForDateRange(opts.period1, opts.period2);
  let cached: AdjCloseBar[] = [];
  let cacheFresh = false;
  try {
    const dbBars = await loadBarsFromDb(sym, opts.period1, opts.period2);
    cacheFresh = isFreshEnough(dbBars);
    cached = dbBars.map((r) => ({
      date: parseDbDate(r.date),
      adjClose: r.adjClose,
      volume: r.volume,
    }));
  } catch {
    cached = [];
    cacheFresh = false;
  }
  if (cacheFresh && coversRange(cached, opts.period1, opts.period2, minBars)) {
    const filtered = cached.filter(
      (b) => b.date >= dateKey(opts.period1) && b.date <= dateKey(opts.period2),
    );
    assertTickerSeries(sym, filtered, opts);
    return filtered;
  }
  const provider = resolveHistoricalProvider({
    symbol: sym,
    intentClass: opts.intentClass,
  });

  let fresh: AdjCloseBar[];
  if (provider === "alpaca") {
    try {
      fresh = await fetchAlpacaHistoricalBars(sym, opts, getAlpacaConfig());
    } catch (e) {
      if (opts.intentClass === "HIGH_FREQUENCY_SCALPING") throw e;
      fresh = await fetchFromYahoo(sym, opts);
    }
  } else {
    fresh = await fetchFromYahoo(sym, opts);
  }

  assertTickerSeries(sym, fresh, opts);
  try {
    await persistBarsToDb(sym, fresh, provider);
  } catch {
    /* DB opzionale in dev senza migrate */
  }
  return fresh;
}

export async function fetchMultiSymbolHistory(
  symbols: string[],
  opts: FetchHistoryOptions,
): Promise<Record<string, AdjCloseBar[]>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const errors: string[] = [];
  const out: Record<string, AdjCloseBar[]> = {};
  for (const sym of unique) {
    try {
      out[sym] = await fetchAdjCloseHistory(sym, opts);
    } catch (e) {
      const msg = e instanceof MarketDataError ? e.message : e instanceof Error ? e.message : String(e);
      errors.push(msg);
    }
  }
  if (errors.length > 0) {
    throw new MarketDataError(
      "TICKER_FETCH_FAILED",
      `Download fallito per ${errors.length}/${unique.length} ticker:\n${errors.join("\n")}`,
      { symbols: unique, failures: errors },
    );
  }
  return out;
}
