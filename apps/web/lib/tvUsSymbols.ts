/**
 * Watchlist “blue chip” US: simbolo TradingView + etichetta + ticker Yahoo (batch quotes).
 */
export type TvMarketCategory = "index" | "etf" | "equity";

export type TvLeaderRow = {
  /** Es. NASDAQ:AAPL */
  tv: string;
  name: string;
  /** Simbolo Yahoo (batch /api/market/quotes) */
  yahoo: string;
  category: TvMarketCategory;
};

export const TV_US_LEADERS: TvLeaderRow[] = [
  { tv: "SP:SPX", name: "S&P 500", yahoo: "^GSPC", category: "index" },
  { tv: "NASDAQ:QQQ", name: "Invesco QQQ", yahoo: "QQQ", category: "etf" },
  { tv: "AMEX:SPY", name: "SPDR S&P 500", yahoo: "SPY", category: "etf" },
  { tv: "AMEX:DIA", name: "Dow SPDR", yahoo: "DIA", category: "etf" },
  { tv: "AMEX:IWM", name: "Russell 2000", yahoo: "IWM", category: "etf" },
  { tv: "CBOE:VIX", name: "VIX", yahoo: "^VIX", category: "index" },
  { tv: "NASDAQ:AAPL", name: "Apple", yahoo: "AAPL", category: "equity" },
  { tv: "NASDAQ:MSFT", name: "Microsoft", yahoo: "MSFT", category: "equity" },
  { tv: "NASDAQ:NVDA", name: "NVIDIA", yahoo: "NVDA", category: "equity" },
  { tv: "NASDAQ:GOOGL", name: "Alphabet", yahoo: "GOOGL", category: "equity" },
  { tv: "NASDAQ:AMZN", name: "Amazon", yahoo: "AMZN", category: "equity" },
  { tv: "NASDAQ:META", name: "Meta", yahoo: "META", category: "equity" },
  { tv: "NASDAQ:TSLA", name: "Tesla", yahoo: "TSLA", category: "equity" },
  { tv: "NYSE:JPM", name: "JPMorgan", yahoo: "JPM", category: "equity" },
  { tv: "NYSE:BRK.B", name: "Berkshire B", yahoo: "BRK-B", category: "equity" },
];

export const TV_CATEGORY_LABELS: Record<TvMarketCategory, string> = {
  index: "Indici",
  etf: "ETF",
  equity: "Azioni",
};
