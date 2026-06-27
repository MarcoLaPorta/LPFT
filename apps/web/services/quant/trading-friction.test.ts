import { describe, expect, it } from "vitest";
import { runEventDrivenBacktest } from "./event-driven-engine";
import { feeOnNotional, maxAffordableBuyNotional, estimateHftRoundTripCostBps, requiredTargetProfitBps } from "./trading-friction";
import type { EventDrivenStrategyConfig } from "./types";
import type { PriceMatrix } from "../market_data/types";

function flatPriceMatrix(days = 10, price = 100): PriceMatrix {
  const calendar = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    return d.toISOString().slice(0, 10);
  });
  return {
    calendar,
    symbols: ["ASSET", "BENCH"],
    prices: {
      ASSET: Array(days).fill(price),
      BENCH: Array(days).fill(price),
    },
  };
}

function pingPongConfig(takerFeeBps: number): EventDrivenStrategyConfig {
  return {
    sourceSignal: "PING_PONG",
    primaryTicker: "ASSET",
    benchmark: "BENCH",
    universe: ["ASSET"],
    baseCurrency: "USDC",
    rebalanceFrequency: "DAILY_SIGNAL",
    takerFeeBps,
    slippageBps: 0,
    risk: {
      maxDrawdownLimit: 0.99,
      stopLossPercentage: 0.99,
      trailingStop: false,
      liquidateToBaseOnMaxDrawdown: false,
    },
    signal: { kind: "alternating" },
  };
}

describe("trading-friction — HFT maker vs taker cost", () => {
  it("maker ha costo round-trip inferiore al taker", () => {
    const maker = estimateHftRoundTripCostBps({
      useLimitOrdersOnly: true,
      estimatedSpreadBps: 8,
      slippageBps: 12,
      makerFeeBps: 0,
      takerFeeBps: 5,
    });
    const taker = estimateHftRoundTripCostBps({
      useLimitOrdersOnly: false,
      estimatedSpreadBps: 8,
      slippageBps: 12,
      makerFeeBps: 0,
      takerFeeBps: 5,
    });
    expect(maker).toBe(0);
    expect(taker).toBeGreaterThan(maker);
    expect(requiredTargetProfitBps({
      useLimitOrdersOnly: true,
      estimatedSpreadBps: 8,
      slippageBps: 12,
      makerFeeBps: 0,
      takerFeeBps: 5,
    })).toBe(0);
  });
});

describe("trading-friction — capital bleed da fee su notional", () => {
  it("feeOnNotional è proporzionale solo al notional scambiato (bps)", () => {
    expect(feeOnNotional(1000, 100)).toBe(10);
    expect(feeOnNotional(100, 30)).toBeCloseTo(0.3, 8);
    expect(feeOnNotional(0, 100)).toBe(0);
  });

  it("maxAffordableBuyNotional riserva cash per fee", () => {
    expect(maxAffordableBuyNotional(100, 100)).toBeCloseTo(100 / 1.01, 8);
  });

  describe("strategia ping-pong su prezzo piatto (10 giorni)", () => {
    const matrix = flatPriceMatrix(10, 100);

    it("takerFeeBps = 0 → PnL finale nullo e capitale invariato", () => {
      const result = runEventDrivenBacktest({
        matrix,
        config: pingPongConfig(0),
        initialCash: 1,
      });

      const finalEquity = result.series[result.series.length - 1].equity;
      expect(finalEquity).toBeCloseTo(1, 8);

      const totalPnl = result.trades.reduce((s, t) => s + t.pnlEquity, 0);
      expect(Math.abs(totalPnl)).toBeLessThan(1e-6);

      const totalFees = result.trades.reduce((s, t) => s + t.transactionFee, 0);
      expect(totalFees).toBe(0);
    });

    it("takerFeeBps = 100 → capitale finale < iniziale (bleed cumulativo)", () => {
      const result = runEventDrivenBacktest({
        matrix,
        config: pingPongConfig(100),
        initialCash: 1,
      });

      const finalEquity = result.series[result.series.length - 1].equity;
      expect(finalEquity).toBeLessThan(1);

      const totalFees = result.trades.reduce((s, t) => s + t.transactionFee, 0);
      expect(totalFees).toBeGreaterThan(0);

      expect(1 - finalEquity).toBeCloseTo(totalFees, 4);
    });

    it("ogni gamba di rebalance registra fee nel trade journal", () => {
      const result = runEventDrivenBacktest({
        matrix,
        config: pingPongConfig(100),
        initialCash: 1,
      });

      const closedWithFees = result.trades.filter((t) => t.transactionFee > 0);
      expect(closedWithFees.length).toBeGreaterThan(0);
      for (const t of closedWithFees) {
        expect(t.transactionFee).toBeGreaterThan(0);
        expect(t.reasonEntry).toContain("PING_PONG");
      }
    });
  });
});
