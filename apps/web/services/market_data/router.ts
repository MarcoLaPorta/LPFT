/**
 * Market Data Router — Tier 1 Phase 1.
 * Alpaca per HFT e equity USA; Yahoo fallback per wallet / macro / non quotati.
 */

export type MarketDataIntentClass =
  | "WALLET_MANAGEMENT"
  | "ALGORITHMIC_TRADING"
  | "HIGH_FREQUENCY_SCALPING";

export type MarketDataProvider = "alpaca" | "yahoo";

const CRYPTO_TICKERS = new Set(["BTC", "ETH", "SOL", "USDC", "USDT", "BNB", "XRP"]);

/** Equity USA quotata (es. AAPL, BRK.B). Esclude indici ^ e crypto. */
export function isUsListedEquity(symbol: string): boolean {
  const t = symbol.trim().toUpperCase();
  if (!t || t.startsWith("^")) return false;
  if (isCryptoSymbol(t)) return false;
  return /^[A-Z]{1,5}(\.[A-Z])?$/.test(t);
}

export function isCryptoSymbol(symbol: string): boolean {
  const t = symbol.trim().toUpperCase();
  if (t.endsWith("-USD") || t.endsWith("/USD")) return true;
  if (CRYPTO_TICKERS.has(t)) return true;
  if (/^[A-Z]{2,5}-USD$/.test(t)) return true;
  return false;
}

export type ResolveProviderInput = {
  symbol: string;
  intentClass?: MarketDataIntentClass;
  /** Preferenza esplicita (test / override). */
  forceProvider?: MarketDataProvider;
};

/**
 * Regole ibride:
 * - HIGH_FREQUENCY_SCALPING → Alpaca (obbligatorio se configurato)
 * - ALGORITHMIC_TRADING + US equity → Alpaca
 * - WALLET_MANAGEMENT, indici, crypto, internazionali → Yahoo
 */
export function resolveHistoricalProvider(input: ResolveProviderInput): MarketDataProvider {
  if (input.forceProvider) return input.forceProvider;

  const sym = input.symbol.trim().toUpperCase();
  const intent = input.intentClass;

  if (intent === "HIGH_FREQUENCY_SCALPING") {
    return "alpaca";
  }

  if (sym.startsWith("^") || isCryptoSymbol(sym)) {
    return "yahoo";
  }

  if (intent === "WALLET_MANAGEMENT") {
    return "yahoo";
  }

  if (intent === "ALGORITHMIC_TRADING" && isUsListedEquity(sym)) {
    return "alpaca";
  }

  return "yahoo";
}

export function providerRequiresAlpaca(provider: MarketDataProvider): boolean {
  return provider === "alpaca";
}
