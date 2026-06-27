import { describe, expect, it } from "vitest";
import type { PriceMatrix } from "../market_data/types";
import { getPiTPrice, PiTLookaheadError, sliceMatrixAsOf } from "./pit-proxy";
import { applyFractionalKellyCap, fullKellyFraction } from "./kelly-sizing";
import { analyzeMarketRegimes } from "./regime-analysis";
import { runEventDrivenBacktest } from "./event-driven-engine";
import type { EventDrivenStrategyConfig } from "./types";

function sampleMatrix(n = 400): PriceMatrix {
  const calendar = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2019, 0, 1 + i));
    return d.toISOString().slice(0, 10);
  });
  const prices = Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 20) * 5 + i * 0.02);
  return {
    calendar,
    symbols: ["ASSET", "BENCH"],
    prices: { ASSET: prices, BENCH: prices.map((p) => p * 0.98) },
  };
}

describe("Phase 3 — PiT proxy", () => {
  it("sliceMatrixAsOf tronca il futuro", () => {
    const m = sampleMatrix(50);
    const pit = sliceMatrixAsOf(m, 10);
    expect(pit.calendar).toHaveLength(11);
    expect(pit.prices.ASSET).toHaveLength(11);
  });

  it("getPiTPrice rifiuta lookahead", () => {
    const m = sampleMatrix(20);
    expect(() => getPiTPrice(m, "ASSET", 15, 10)).toThrow(PiTLookaheadError);
  });
});

describe("Phase 3 — regime analysis", () => {
  it("rileva overlap Covid su serie 2020+", () => {
    const matrix = sampleMatrix(800);
    const config: EventDrivenStrategyConfig = {
      sourceSignal: "TEST",
      primaryTicker: "ASSET",
      benchmark: "BENCH",
      universe: ["ASSET"],
      baseCurrency: "USDC",
      rebalanceFrequency: "NONE",
      risk: {
        maxDrawdownLimit: 0.5,
        stopLossPercentage: 0.5,
        trailingStop: false,
        liquidateToBaseOnMaxDrawdown: false,
      },
      signal: { kind: "buy_and_hold" },
    };
    const result = runEventDrivenBacktest({ matrix, config });
    expect(result.regimeAnalysis).toBeDefined();
    const covid = result.regimeAnalysis!.windows.find((w) => w.id === "covid_crash");
    expect(covid?.overlap).toBe(true);
    expect(covid!.barCount).toBeGreaterThan(10);
  });
});

describe("Phase 3 — fractional Kelly", () => {
  it("fullKellyFraction è limitato a [0,1]", () => {
    const f = fullKellyFraction(0.55, 0.02, 0.01);
    expect(f).not.toBeNull();
    expect(f!).toBeGreaterThanOrEqual(0);
    expect(f!).toBeLessThanOrEqual(1);
  });

  it("applyFractionalKellyCap riduce pesi elevati", () => {
    const capped = applyFractionalKellyCap(
      { ASSET: 1 },
      [
        {
          tradeIndex: 1,
          side: "LONG",
          symbol: "ASSET",
          entryDate: "2020-01-01",
          exitDate: "2020-02-01",
          entryPrice: 100,
          exitPrice: 110,
          entryEquity: 1,
          exitEquity: 1.1,
          pnlFrac: 0.1,
          pnlEquity: 0.1,
          reasonEntry: "t",
          reasonExit: "t",
          transactionFee: 0,
        },
        {
          tradeIndex: 2,
          side: "LONG",
          symbol: "ASSET",
          entryDate: "2020-03-01",
          exitDate: "2020-04-01",
          entryPrice: 100,
          exitPrice: 90,
          entryEquity: 1,
          exitEquity: 0.9,
          pnlFrac: -0.1,
          pnlEquity: -0.1,
          reasonEntry: "t",
          reasonExit: "t",
          transactionFee: 0,
        },
        {
          tradeIndex: 3,
          side: "LONG",
          symbol: "ASSET",
          entryDate: "2020-05-01",
          exitDate: "2020-06-01",
          entryPrice: 100,
          exitPrice: 105,
          entryEquity: 1,
          exitEquity: 1.05,
          pnlFrac: 0.05,
          pnlEquity: 0.05,
          reasonEntry: "t",
          reasonExit: "t",
          transactionFee: 0,
        },
        {
          tradeIndex: 4,
          side: "LONG",
          symbol: "ASSET",
          entryDate: "2020-07-01",
          exitDate: "2020-08-01",
          entryPrice: 100,
          exitPrice: 108,
          entryEquity: 1,
          exitEquity: 1.08,
          pnlFrac: 0.08,
          pnlEquity: 0.08,
          reasonEntry: "t",
          reasonExit: "t",
          transactionFee: 0,
        },
        {
          tradeIndex: 5,
          side: "LONG",
          symbol: "ASSET",
          entryDate: "2020-09-01",
          exitDate: "2020-10-01",
          entryPrice: 100,
          exitPrice: 95,
          entryEquity: 1,
          exitEquity: 0.95,
          pnlFrac: -0.05,
          pnlEquity: -0.05,
          reasonEntry: "t",
          reasonExit: "t",
          transactionFee: 0,
        },
      ],
      { fractionalKelly: 0.25, fallbackMaxWeight: 0.2 },
    );
    expect(capped.ASSET).toBeLessThanOrEqual(0.25);
  });
});
