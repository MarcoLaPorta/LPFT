import { describe, expect, it } from "vitest";
import {
  buildActiveSessionMask,
  buildCombinedActiveSessionMask,
  buildPriceMatrix,
  estimateTradingDaysPerYear,
} from "../market_data/price_matrix";
import type { AdjCloseBar } from "../market_data/types";
import {
  buyFillPrice,
  defaultSlippageBpsForSymbol,
  resolveSlippageBpsForSymbol,
  sellFillPrice,
} from "./trading-friction";
import { runEventDrivenBacktest } from "./event-driven-engine";
import { computeMetricsFromEquity } from "./metrics";
import type { EventDrivenStrategyConfig } from "./types";
import type { PriceMatrix } from "../market_data/types";

describe("Tier 1 — T+1 execution", () => {
  it("il primo fill avviene al giorno i+1 (non stesso bar del segnale)", () => {
    const calendar = ["2024-01-01", "2024-01-02", "2024-01-03"];
    const matrix: PriceMatrix = {
      calendar,
      symbols: ["ASSET", "BENCH"],
      prices: { ASSET: [100, 101, 102], BENCH: [100, 100, 100] },
    };
    const config: EventDrivenStrategyConfig = {
      sourceSignal: "TEST",
      primaryTicker: "ASSET",
      benchmark: "BENCH",
      universe: ["ASSET"],
      baseCurrency: "USDC",
      rebalanceFrequency: "NONE",
      slippageBps: 0,
      risk: {
        maxDrawdownLimit: 0.99,
        stopLossPercentage: 0.99,
        trailingStop: false,
        liquidateToBaseOnMaxDrawdown: false,
      },
      signal: { kind: "buy_and_hold" },
    };
    const result = runEventDrivenBacktest({ matrix, config, initialCash: 1 });
    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    expect(result.trades[0].entryDate).toBe("2024-01-02");
    expect(result.trades[0].entryPrice).toBe(101);
  });
});

describe("Tier 1 — slippage on fill", () => {
  it("buyFillPrice e sellFillPrice applicano bps in modo simmetrico", () => {
    expect(buyFillPrice(100, 10)).toBeCloseTo(100.1, 8);
    expect(sellFillPrice(100, 10)).toBeCloseTo(99.9, 8);
  });

  it("slippageBps > 0 riduce equity vs stesso scenario senza slippage (ping-pong)", () => {
    const calendar = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1 + i));
      return d.toISOString().slice(0, 10);
    });
    const matrix: PriceMatrix = {
      calendar,
      symbols: ["ASSET", "BENCH"],
      prices: { ASSET: Array(8).fill(100), BENCH: Array(8).fill(100) },
    };
    const base: EventDrivenStrategyConfig = {
      sourceSignal: "PING",
      primaryTicker: "ASSET",
      benchmark: "BENCH",
      universe: ["ASSET"],
      baseCurrency: "USDC",
      rebalanceFrequency: "DAILY_SIGNAL",
      takerFeeBps: 0,
      risk: {
        maxDrawdownLimit: 0.99,
        stopLossPercentage: 0.99,
        trailingStop: false,
        liquidateToBaseOnMaxDrawdown: false,
      },
      signal: { kind: "alternating" },
    };
    const noSlip = runEventDrivenBacktest({ matrix, config: { ...base, slippageBps: 0 } });
    const withSlip = runEventDrivenBacktest({ matrix, config: { ...base, slippageBps: 20 } });
    const eqNo = noSlip.series[noSlip.series.length - 1].equity;
    const eqSl = withSlip.series[withSlip.series.length - 1].equity;
    expect(eqSl).toBeLessThan(eqNo);
  });

  it("default slippage: crypto > large-cap ETF", () => {
    const btc = defaultSlippageBpsForSymbol("BTC-USD");
    const spy = defaultSlippageBpsForSymbol("SPY");
    expect(btc).toBeGreaterThan(spy);
    expect(resolveSlippageBpsForSymbol("BTC-USD", 7)).toBe(7);
  });
});

describe("Tier 1 — metriche su sessioni attive", () => {
  it("esclude rendimenti 0% da forward-fill weekend dal campione Sharpe", () => {
    const equity = [1, 1.01, 1.01, 1.02, 1.02, 1.03];
    const mask = [true, true, false, true, false, true];
    const allDays = computeMetricsFromEquity(equity, { tradingDaysPerYear: 252 });
    const activeOnly = computeMetricsFromEquity(equity, {
      activeSessionMask: mask,
      tradingDaysPerYear: 252,
    });
    expect(activeOnly.sharpe).toBeGreaterThan(allDays.sharpe);
  });

  it("buildActiveSessionMask marca false i giorni flat (ffill)", () => {
    const bars: AdjCloseBar[] = [
      { date: "2024-01-05", adjClose: 100, volume: 1e6 },
      { date: "2024-01-06", adjClose: 100, volume: 0 },
      { date: "2024-01-08", adjClose: 101, volume: 1e6 },
    ];
    const matrix = buildPriceMatrix({ QQQ: bars });
    const mask = buildActiveSessionMask(matrix, "QQQ");
    expect(mask[0]).toBe(true);
    expect(mask[1]).toBe(false);
    expect(mask[2]).toBe(true);
    const tdy = estimateTradingDaysPerYear(mask, matrix.calendar.length);
    expect(tdy).toBeGreaterThanOrEqual(200);
    expect(tdy).toBeLessThanOrEqual(252);
  });

  it("buildCombinedActiveSessionMask mantiene giorni crypto attivi su universo misto", () => {
    const matrix: PriceMatrix = {
      calendar: ["2024-01-05", "2024-01-06", "2024-01-07"],
      symbols: ["QQQ", "BTC-USD"],
      prices: {
        QQQ: [100, 100, 100],
        "BTC-USD": [50_000, 50_100, 50_250],
      },
    };
    const mask = buildCombinedActiveSessionMask(matrix, "QQQ", ["QQQ", "BTC-USD"]);
    expect(mask).toEqual([true, true, true]);
  });
});
