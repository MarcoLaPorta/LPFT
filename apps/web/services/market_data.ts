import YahooFinance from "yahoo-finance2";
import {
  fetchAdjCloseHistory,
  fetchMultiSymbolHistory,
  minBarsForDateRange,
} from "./market_data/data_fetcher";
import {
  assertPriceMatrixReady,
  buildPriceMatrix,
  priceMatrixToAlignedRows,
  trimMatrixToValidRange,
} from "./market_data/price_matrix";
export { MarketDataError } from "./market_data/errors";
import type {
  AdjCloseBar,
  AlignedPriceRow,
  FetchHistoryOptions,
  OhlcvBar,
  OhlcvInterval,
  PriceMatrix,
} from "./market_data/types";

export type {
  AdjCloseBar,
  AlignedPriceRow,
  FetchHistoryOptions,
  OhlcvBar,
  OhlcvInterval,
  PriceMatrix,
} from "./market_data/types";

export {
  buildPriceMatrix,
  trimMatrixToValidRange,
  assertPriceMatrixReady,
  buildActiveSessionMask,
  estimateTradingDaysPerYear,
  resolveRegulatedSessionProxy,
} from "./market_data/price_matrix";
export {
  fetchAdjCloseHistory,
  fetchMultiSymbolHistory,
  minBarsForDateRange,
} from "./market_data/data_fetcher";
export {
  resolveHistoricalProvider,
  isUsListedEquity,
  isCryptoSymbol,
  type MarketDataIntentClass,
  type MarketDataProvider,
} from "./market_data/router";
export { getAlpacaConfig, isAlpacaConfigured } from "./market_data/alpaca-config";
export { fetchAlpacaHistoricalBars } from "./market_data/alpaca-historical";
export { AlpacaStreamAdapter } from "./market_data/stream/alpaca-stream-adapter";
export type { IWebSocketMarketStream } from "./market_data/stream/types";
export { TickReplayEngine } from "./market_data/tick-replay-engine";
export type { TickReplayStats } from "./market_data/tick-replay-engine";
export {
  HFT_MIN_REPLAY_SECONDS,
  HFT_MAX_REPLAY_SECONDS,
  HFT_DEFAULT_LOOKBACK_DAYS,
  HFT_DEFAULT_MAX_SESSIONS,
  resolveHftReplayRange,
  resolveAlpacaTickRoute,
  buildHftReplaySessions,
  sessionWindowSeconds,
  resolveHftReplayWindowSeconds,
} from "./market_data/hft-replay-config";
export { runMultiSessionHftReplay } from "./market_data/hft-multi-session-replay";
export type { MultiSessionHftReplayStats } from "./market_data/hft-multi-session-replay";

const yahooFinance = new YahooFinance();

/**
 * Storico giornaliero: solo adjClose (campo `close` nel tipo legacy = adjClose).
 */
export async function fetchHistoricalOhlcv(
  symbol: string,
  opts: FetchHistoryOptions,
): Promise<OhlcvBar[]> {
  const bars = await fetchAdjCloseHistory(symbol, opts);
  return bars.map((b) => ({
    date: b.date,
    open: b.adjClose,
    high: b.adjClose,
    low: b.adjClose,
    close: b.adjClose,
    volume: b.volume,
  }));
}

/**
 * Scarica universo + benchmark, allinea con master calendar + forward-fill.
 */
export async function fetchUniversePriceMatrix(
  symbols: string[],
  benchmarkSymbol: string,
  opts: FetchHistoryOptions,
): Promise<PriceMatrix> {
  const all = [...new Set([...symbols.map((s) => s.toUpperCase()), benchmarkSymbol.toUpperCase()])];
  const series = await fetchMultiSymbolHistory(all, opts);
  const raw = buildPriceMatrix(series);
  const trimmed = trimMatrixToValidRange(raw, all);
  const minDays = minBarsForDateRange(opts.period1, opts.period2);
  assertPriceMatrixReady(trimmed, all, minDays);
  return trimmed;
}

/**
 * Asset + benchmark allineati (compat API). Usa forward-fill, non inner-join.
 */
export async function fetchPairedHistory(
  symbol: string,
  benchmarkSymbol: string,
  opts: FetchHistoryOptions,
): Promise<{ asset: OhlcvBar[]; benchmark: OhlcvBar[]; aligned: AlignedPriceRow[] }> {
  const sym = symbol.toUpperCase();
  const bench = benchmarkSymbol.toUpperCase();
  const matrix = await fetchUniversePriceMatrix([sym], bench, opts);
  const aligned = priceMatrixToAlignedRows(matrix, sym, bench);
  const asset: OhlcvBar[] = aligned.map((r) => ({
    date: r.date,
    open: r.assetClose,
    high: r.assetClose,
    low: r.assetClose,
    close: r.assetClose,
    volume: 0,
  }));
  const benchmark: OhlcvBar[] = aligned.map((r) => ({
    date: r.date,
    open: r.benchClose,
    high: r.benchClose,
    low: r.benchClose,
    close: r.benchClose,
    volume: 0,
  }));
  return { asset, benchmark, aligned };
}

/** Dati sintetici per strip / watchlist (Yahoo `quote`). */
export type EquityQuoteBrief = {
  symbol: string;
  shortName: string | null;
  longName: string | null;
  currency: string | null;
  regularMarketPrice: number | null;
  regularMarketChange: number | null;
  regularMarketChangePercent: number | null;
  regularMarketPreviousClose: number | null;
  regularMarketOpen: number | null;
  regularMarketDayHigh: number | null;
  regularMarketDayLow: number | null;
  regularMarketVolume: number | null;
  marketState: string | null;
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export async function fetchEquityQuotes(symbols: string[]): Promise<EquityQuoteBrief[]> {
  const unique = [
    ...new Set(
      symbols
        .map((s) => s.trim().toUpperCase())
        .filter((s) => /^(\^[A-Z0-9.\-]{1,24}|[A-Z0-9][A-Z0-9.\-]{0,24})$/.test(s)),
    ),
  ].slice(0, 24);
  if (unique.length === 0) return [];

  const raw = await yahooFinance.quote(unique, {
    fields: [
      "symbol",
      "shortName",
      "longName",
      "currency",
      "regularMarketPrice",
      "regularMarketChange",
      "regularMarketChangePercent",
      "regularMarketPreviousClose",
      "regularMarketOpen",
      "regularMarketDayHigh",
      "regularMarketDayLow",
      "regularMarketVolume",
      "marketState",
    ],
  });

  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((row) => {
    const o = row as Record<string, unknown>;
    return {
      symbol: str(o.symbol) ?? "",
      shortName: str(o.shortName),
      longName: str(o.longName),
      currency: str(o.currency),
      regularMarketPrice: num(o.regularMarketPrice),
      regularMarketChange: num(o.regularMarketChange),
      regularMarketChangePercent: num(o.regularMarketChangePercent),
      regularMarketPreviousClose: num(o.regularMarketPreviousClose),
      regularMarketOpen: num(o.regularMarketOpen),
      regularMarketDayHigh: num(o.regularMarketDayHigh),
      regularMarketDayLow: num(o.regularMarketDayLow),
      regularMarketVolume: num(o.regularMarketVolume),
      marketState: str(o.marketState),
    };
  });
}
