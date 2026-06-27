import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export type OhlcvInterval = "1d" | "1wk" | "1mo";

export type OhlcvBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type FetchHistoryOptions = {
  period1: Date;
  period2: Date;
  interval?: OhlcvInterval;
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isHistoryRow(
  r: unknown,
): r is { date: Date; open: number; high: number; low: number; close: number; adjClose?: number; volume: number } {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    o.date instanceof Date &&
    typeof o.close === "number" &&
    typeof o.open === "number" &&
    typeof o.high === "number" &&
    typeof o.low === "number"
  );
}

/**
 * Storico OHLCV giornaliero (o weekly/monthly) via Yahoo Finance — solo lato server.
 */
export async function fetchHistoricalOhlcv(
  symbol: string,
  opts: FetchHistoryOptions,
): Promise<OhlcvBar[]> {
  const raw = await yahooFinance.historical(symbol, {
    period1: opts.period1,
    period2: opts.period2,
    interval: opts.interval ?? "1d",
  });

  if (!Array.isArray(raw)) {
    throw new Error(`Yahoo historical: unexpected response for ${symbol}`);
  }

  const bars: OhlcvBar[] = raw
    .filter(isHistoryRow)
    .map((r) => {
      const px = r.adjClose ?? r.close;
      return {
        date: dateKey(r.date),
        open: r.open,
        high: r.high,
        low: r.low,
        close: px,
        volume: typeof r.volume === "number" ? r.volume : 0,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return bars;
}

export type AlignedPriceRow = {
  date: string;
  assetClose: number;
  benchClose: number;
};

/**
 * Scarica asset e benchmark e li allinea per data di sessione (inner join).
 * Benchmark tipico indice: `^GSPC` (S&P 500).
 */
export async function fetchPairedHistory(
  symbol: string,
  benchmarkSymbol: string,
  opts: FetchHistoryOptions,
): Promise<{ asset: OhlcvBar[]; benchmark: OhlcvBar[]; aligned: AlignedPriceRow[] }> {
  const [asset, benchmark] = await Promise.all([
    fetchHistoricalOhlcv(symbol, opts),
    fetchHistoricalOhlcv(benchmarkSymbol, opts),
  ]);

  const benchByDate = new Map(benchmark.map((b) => [b.date, b.close]));
  const aligned: AlignedPriceRow[] = [];
  for (const row of asset) {
    const bc = benchByDate.get(row.date);
    if (bc != null) {
      aligned.push({ date: row.date, assetClose: row.close, benchClose: bc });
    }
  }

  return { asset, benchmark, aligned };
}
