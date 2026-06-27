import type { HFTExecutionEngine } from "../quant/hft-engine";
import { getAlpacaConfig } from "./alpaca-config";
import { MarketDataError } from "./errors";
import {
  HFT_MIN_REPLAY_SPAN_MS,
  resolveAlpacaTickRoute,
  type AlpacaTickRoute,
} from "./hft-replay-config";
import type { IWebSocketMarketStream, StreamHandlers } from "./stream/types";

type AlpacaStockTrade = { t: string; p: number; s: number };
type AlpacaStockQuote = { t: string; bp: number; ap: number; bs?: number; as?: number };
type AlpacaCryptoTrade = { t: string; p: number; s: number };
type AlpacaCryptoQuote = { t: string; bp: number; ap: number; bs?: number; as?: number };

export type TickReplayOptions = {
  symbol: string;
  start: Date;
  end: Date;
  /** 0 = replay istantaneo; 1 = real-time wall clock. */
  speed?: number;
};

export type TickReplayStats = {
  symbol: string;
  alpacaSymbol: string;
  assetClass: AlpacaTickRoute["assetClass"];
  eventCount: number;
  tradeEvents: number;
  quoteEvents: number;
  spanMs: number;
  windowStart: string;
  windowEnd: string;
};

type ReplayEvent = {
  kind: "trade" | "quote";
  ts: number;
  price: number;
  size: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  latencyMs: number;
};

/**
 * Replay tick + quote Alpaca (REST) verso HFTExecutionEngine.
 * Sprint 1: unico percorso dati HFT — niente mock sintetico.
 */
export class TickReplayEngine implements IWebSocketMarketStream {
  readonly provider = "alpaca-replay";

  private handlers: StreamHandlers = {};
  private aborted = false;
  private lastStats: TickReplayStats | null = null;

  setHandlers(handlers: StreamHandlers): void {
    this.handlers = handlers;
  }

  isConnected(): boolean {
    return !this.aborted;
  }

  getLastReplayStats(): TickReplayStats | null {
    return this.lastStats;
  }

  async connect(_symbols: string[]): Promise<void> {
    this.aborted = false;
    this.handlers.onConnect?.();
  }

  subscribe(): void {
    /* one-shot replay */
  }

  async disconnect(): Promise<void> {
    this.aborted = true;
    this.handlers.onDisconnect?.();
  }

  async replayToEngine(engine: HFTExecutionEngine, opts: TickReplayOptions): Promise<TickReplayStats> {
    const { events, stats } = await this.loadEvents(opts);
    this.lastStats = stats;
    const speed = opts.speed ?? 0;

    this.handlers.onConnect?.();
    let prevTs = events[0]?.ts ?? 0;

    for (const ev of events) {
      if (this.aborted) break;
      if (speed > 0 && prevTs > 0) {
        const delta = Math.max(0, ev.ts - prevTs);
        await sleep(Math.min(delta / speed, 50));
      }
      prevTs = ev.ts;

      if (ev.kind === "trade") {
        await engine.onTick({ ts: ev.ts, price: ev.price, size: ev.size }, ev.latencyMs);
        this.handlers.onTick?.({ ts: ev.ts, price: ev.price, size: ev.size });
      } else {
        await engine.onOrderBookUpdate(
          {
            ts: ev.ts,
            bids: [{ price: ev.bid, size: ev.bidSize }],
            asks: [{ price: ev.ask, size: ev.askSize }],
          },
          ev.latencyMs,
        );
        this.handlers.onOrderBook?.({
          ts: ev.ts,
          bids: [{ price: ev.bid, size: ev.bidSize }],
          asks: [{ price: ev.ask, size: ev.askSize }],
        });
      }
    }
    await this.disconnect();
    return stats;
  }

  private async loadEvents(opts: TickReplayOptions): Promise<{ events: ReplayEvent[]; stats: TickReplayStats }> {
    const cfg = getAlpacaConfig();
    if (!cfg) {
      throw new MarketDataError(
        "TICKER_FETCH_FAILED",
        "Replay HFT richiede ALPACA_API_KEY e ALPACA_API_SECRET in .env.local",
        { symbol: opts.symbol },
      );
    }

    const route = resolveAlpacaTickRoute(opts.symbol);
    if (!route) {
      throw new MarketDataError(
        "TICKER_FETCH_FAILED",
        `Ticker ${opts.symbol} non supportato per replay Alpaca HFT (usa equity USA es. SPY, AAPL, o crypto BTC/USD ETH/USD)`,
        { symbol: opts.symbol },
      );
    }

    const start = opts.start.toISOString();
    const end = opts.end.toISOString();
    const headers = {
      "APCA-API-KEY-ID": cfg.apiKey,
      "APCA-API-SECRET-KEY": cfg.apiSecret,
    };

    const out: ReplayEvent[] =
      route.assetClass === "us_equity"
        ? await this.loadUsEquityEvents(cfg.dataBaseUrl, route.alpacaSymbol, start, end, headers)
        : await this.loadCryptoEvents(cfg.dataBaseUrl, route.alpacaSymbol, start, end, headers);

    out.sort((a, b) => a.ts - b.ts);

    if (out.length === 0) {
      throw new MarketDataError(
        "TICKER_EMPTY_SERIES",
        `Nessun tick/quote Alpaca per ${route.alpacaSymbol} tra ${start} e ${end}`,
        { symbol: route.alpacaSymbol, start, end },
      );
    }

    const requestedSpanMs = opts.end.getTime() - opts.start.getTime();
    const spanMs = out[out.length - 1]!.ts - out[0]!.ts;
    // Quote sparse ai bordi: accetta ≥92% della finestra richiesta (min 50 min).
    const minEventSpanMs = Math.max(3_000_000, requestedSpanMs * 0.88);
    if (spanMs < minEventSpanMs) {
      throw new MarketDataError(
        "TICKER_INSUFFICIENT_BARS",
        `Replay HFT: copertura eventi ${Math.round(spanMs / 60_000)} minuti (richiesti ≥ ${Math.round(minEventSpanMs / 60_000)} min su finestra ${Math.round(requestedSpanMs / 60_000)} min). ` +
          `Usa equity USA in orario REG (SPY, AAPL) o allarga la finestra; crypto richiede piano dati Alpaca attivo.`,
        {
          symbol: route.alpacaSymbol,
          spanMs,
          requiredSpanMs: minEventSpanMs,
          requestedSpanMs,
          eventCount: out.length,
        },
      );
    }

    const stats: TickReplayStats = {
      symbol: opts.symbol.toUpperCase(),
      alpacaSymbol: route.alpacaSymbol,
      assetClass: route.assetClass,
      eventCount: out.length,
      tradeEvents: out.filter((e) => e.kind === "trade").length,
      quoteEvents: out.filter((e) => e.kind === "quote").length,
      spanMs,
      windowStart: start,
      windowEnd: end,
    };

    return { events: out, stats };
  }

  private async loadUsEquityEvents(
    dataBaseUrl: string,
    symbol: string,
    start: string,
    end: string,
    headers: Record<string, string>,
  ): Promise<ReplayEvent[]> {
    const trades = await fetchAllStockTrades(dataBaseUrl, symbol, start, end, headers);
    const quotes = await fetchAllStockQuotes(dataBaseUrl, symbol, start, end, headers);
    const out: ReplayEvent[] = [];

    for (const t of trades) {
      out.push({
        kind: "trade",
        ts: new Date(t.t).getTime(),
        price: t.p,
        size: t.s,
        bid: t.p,
        ask: t.p,
        bidSize: 0,
        askSize: 0,
        latencyMs: 0,
      });
    }
    for (const q of quotes) {
      out.push({
        kind: "quote",
        ts: new Date(q.t).getTime(),
        price: (q.bp + q.ap) / 2,
        size: 0,
        bid: q.bp,
        ask: q.ap,
        bidSize: q.bs ?? 1,
        askSize: q.as ?? 1,
        latencyMs: 0,
      });
    }
    return out;
  }

  private async loadCryptoEvents(
    dataBaseUrl: string,
    symbol: string,
    start: string,
    end: string,
    headers: Record<string, string>,
  ): Promise<ReplayEvent[]> {
    const trades = await fetchAllCryptoTrades(dataBaseUrl, symbol, start, end, headers);
    const quotes = await fetchAllCryptoQuotes(dataBaseUrl, symbol, start, end, headers);
    const out: ReplayEvent[] = [];

    for (const t of trades) {
      out.push({
        kind: "trade",
        ts: new Date(t.t).getTime(),
        price: t.p,
        size: t.s,
        bid: t.p,
        ask: t.p,
        bidSize: 0,
        askSize: 0,
        latencyMs: 0,
      });
    }
    for (const q of quotes) {
      out.push({
        kind: "quote",
        ts: new Date(q.t).getTime(),
        price: (q.bp + q.ap) / 2,
        size: 0,
        bid: q.bp,
        ask: q.ap,
        bidSize: q.bs ?? 1,
        askSize: q.as ?? 1,
        latencyMs: 0,
      });
    }
    return out;
  }
}

const PAGE_LIMIT = 10_000;
const MAX_PAGES = 40;

async function fetchAllStockTrades(
  base: string,
  symbol: string,
  start: string,
  end: string,
  headers: Record<string, string>,
): Promise<AlpacaStockTrade[]> {
  const all: AlpacaStockTrade[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/v2/stocks/${symbol}/trades`);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("feed", "iex");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) break;
    const json = (await res.json()) as { trades?: AlpacaStockTrade[]; next_page_token?: string };
    all.push(...(json.trades ?? []));
    pageToken = json.next_page_token;
    if (!pageToken) break;
  }
  return all;
}

async function fetchAllStockQuotes(
  base: string,
  symbol: string,
  start: string,
  end: string,
  headers: Record<string, string>,
): Promise<AlpacaStockQuote[]> {
  const all: AlpacaStockQuote[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/v2/stocks/${symbol}/quotes`);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("feed", "iex");
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) break;
    const json = (await res.json()) as { quotes?: AlpacaStockQuote[]; next_page_token?: string };
    all.push(...(json.quotes ?? []));
    pageToken = json.next_page_token;
    if (!pageToken) break;
  }
  return all;
}

async function fetchAllCryptoTrades(
  base: string,
  symbol: string,
  start: string,
  end: string,
  headers: Record<string, string>,
): Promise<AlpacaCryptoTrade[]> {
  const all: AlpacaCryptoTrade[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/v1beta3/crypto/us/trades`);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) break;
    const json = (await res.json()) as {
      trades?: Record<string, AlpacaCryptoTrade[]>;
      next_page_token?: string;
    };
    all.push(...(json.trades?.[symbol] ?? []));
    pageToken = json.next_page_token;
    if (!pageToken) break;
  }
  return all;
}

async function fetchAllCryptoQuotes(
  base: string,
  symbol: string,
  start: string,
  end: string,
  headers: Record<string, string>,
): Promise<AlpacaCryptoQuote[]> {
  const all: AlpacaCryptoQuote[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${base}/v1beta3/crypto/us/quotes`);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) break;
    const json = (await res.json()) as {
      quotes?: Record<string, AlpacaCryptoQuote[]>;
      next_page_token?: string;
    };
    all.push(...(json.quotes?.[symbol] ?? []));
    pageToken = json.next_page_token;
    if (!pageToken) break;
  }
  return all;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
