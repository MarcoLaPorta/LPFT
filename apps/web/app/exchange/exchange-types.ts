/** Quotazione Yahoo allineata a EquityQuoteBrief (API /api/market/quotes). */
export type FullExchangeQuote = {
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

export type ChartInterval = "1" | "5" | "15" | "60" | "D" | "W";

export const CHART_INTERVALS: { id: ChartInterval; label: string }[] = [
  { id: "1", label: "1m" },
  { id: "5", label: "5m" },
  { id: "15", label: "15m" },
  { id: "60", label: "1h" },
  { id: "D", label: "1D" },
  { id: "W", label: "1W" },
];
