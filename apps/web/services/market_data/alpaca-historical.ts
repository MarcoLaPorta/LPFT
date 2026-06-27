import type { AdjCloseBar, FetchHistoryOptions } from "./types";
import { MarketDataError } from "./errors";
import { getAlpacaConfig, type AlpacaConfig } from "./alpaca-config";

type AlpacaBar = {
  t: string;
  c: number;
  v: number;
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mapInterval(interval: FetchHistoryOptions["interval"]): string {
  switch (interval) {
    case "1wk":
      return "1Week";
    case "1mo":
      return "1Month";
    default:
      return "1Day";
  }
}

/**
 * Alpaca Market Data v2 — barre OHLCV con adjustment split.
 * https://docs.alpaca.markets/reference/stockbars
 */
export async function fetchAlpacaHistoricalBars(
  symbol: string,
  opts: FetchHistoryOptions,
  config?: AlpacaConfig | null,
): Promise<AdjCloseBar[]> {
  const cfg = config ?? getAlpacaConfig();
  if (!cfg) {
    throw new MarketDataError(
      "TICKER_FETCH_FAILED",
      "Alpaca non configurata: imposta ALPACA_API_KEY e ALPACA_API_SECRET",
      { symbol, provider: "alpaca" },
    );
  }

  const sym = symbol.toUpperCase();
  const timeframe = mapInterval(opts.interval);
  const start = opts.period1.toISOString();
  const end = opts.period2.toISOString();

  const url = new URL(`${cfg.dataBaseUrl}/v2/stocks/${encodeURIComponent(sym)}/bars`);
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("adjustment", "split");
  url.searchParams.set("feed", "iex");
  url.searchParams.set("limit", "10000");

  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": cfg.apiKey,
    "APCA-API-SECRET-KEY": cfg.apiSecret,
  };

  const all: AlpacaBar[] = [];
  let nextPage: string | null = url.toString();

  while (nextPage) {
    const res = await fetch(nextPage, { headers, cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MarketDataError(
        "TICKER_FETCH_FAILED",
        `Alpaca bars ${sym}: HTTP ${res.status} ${body.slice(0, 200)}`,
        { symbol: sym, status: res.status, provider: "alpaca" },
      );
    }
    const json = (await res.json()) as {
      bars?: AlpacaBar[] | null;
      next_page_token?: string | null;
    };
    if (json.bars?.length) all.push(...json.bars);
    if (json.next_page_token) {
      const pageUrl = new URL(url.toString());
      pageUrl.searchParams.set("page_token", json.next_page_token);
      nextPage = pageUrl.toString();
    } else {
      nextPage = null;
    }
  }

  const bars: AdjCloseBar[] = all
    .map((b) => ({
      date: dateKey(new Date(b.t)),
      adjClose: b.c,
      volume: b.v ?? 0,
    }))
    .filter((b) => b.date >= dateKey(opts.period1) && b.date <= dateKey(opts.period2))
    .sort((a, b) => a.date.localeCompare(b.date));

  return bars;
}
