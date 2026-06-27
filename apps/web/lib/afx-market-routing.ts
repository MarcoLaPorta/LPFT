/** Orario Wall Street (America/New_York) per routing PRIMARY vs SECONDARY. */
export function isUsEquitySessionOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? -1);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? -1);
  const mins = hour * 60 + minute;
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return mins >= open && mins < close;
}

export type MarketRoutingMode =
  | "PRIMARY_MINT_BURN"
  | "PRIMARY_RFQ_ATOMIC"
  | "SECONDARY_AMM";

const CRYPTO_TICKERS = new Set(["BTC", "ETH", "SOL", "USDC", "USDT", "WETH"]);

/** Ticker crypto → esecuzione AMM (Uniswap). */
export function isCryptoTicker(ticker: string): boolean {
  const t = ticker.toUpperCase().replace(/^\^/, "");
  if (t.endsWith("-USD") || t.endsWith("USD")) return true;
  return CRYPTO_TICKERS.has(t) || CRYPTO_TICKERS.has(t.split("-")[0] ?? "");
}

/** Equity / ETF / RWA (non crypto). */
export function isRwaEquityTicker(ticker: string): boolean {
  return !isCryptoTicker(ticker);
}

/** Suggerimento deterministico se il modello non specifica il routing. */
export function suggestMarketRoutingMode(ticker: string): MarketRoutingMode {
  if (isCryptoTicker(ticker)) return "SECONDARY_AMM";
  if (isUsEquitySessionOpen()) return "PRIMARY_MINT_BURN";
  return "PRIMARY_RFQ_ATOMIC";
}
