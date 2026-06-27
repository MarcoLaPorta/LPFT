import { describe, expect, it } from "vitest";
import { isCryptoSymbol, isUsListedEquity, resolveHistoricalProvider } from "./router";

describe("Market Data Router", () => {
  it("HFT → Alpaca", () => {
    expect(
      resolveHistoricalProvider({
        symbol: "AAPL",
        intentClass: "HIGH_FREQUENCY_SCALPING",
      }),
    ).toBe("alpaca");
  });

  it("WALLET_MANAGEMENT → Yahoo anche su equity USA", () => {
    expect(
      resolveHistoricalProvider({
        symbol: "SPY",
        intentClass: "WALLET_MANAGEMENT",
      }),
    ).toBe("yahoo");
  });

  it("ALGORITHMIC_TRADING + US equity → Alpaca", () => {
    expect(
      resolveHistoricalProvider({
        symbol: "MSFT",
        intentClass: "ALGORITHMIC_TRADING",
      }),
    ).toBe("alpaca");
  });

  it("indici e crypto → Yahoo", () => {
    expect(resolveHistoricalProvider({ symbol: "^GSPC" })).toBe("yahoo");
    expect(resolveHistoricalProvider({ symbol: "BTC-USD" })).toBe("yahoo");
    expect(isCryptoSymbol("ETH-USD")).toBe(true);
    expect(isUsListedEquity("^GSPC")).toBe(false);
    expect(isUsListedEquity("AAPL")).toBe(true);
  });
});
