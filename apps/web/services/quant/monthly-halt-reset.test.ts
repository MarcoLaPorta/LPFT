import { describe, expect, it } from "vitest";
import { runEventDrivenBacktest } from "./event-driven-engine";
import type { EventDrivenStrategyConfig } from "./types";
import type { PriceMatrix } from "../market_data/types";

/** Gennaio crash + halt; febbraio recovery — ribilanciamento MONTHLY consente rientro T+1. */
function buildTwoMonthMatrix(): PriceMatrix {
  const jan = Array.from({ length: 31 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    return d.toISOString().slice(0, 10);
  });
  const feb = Array.from({ length: 29 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 1, 1 + i));
    return d.toISOString().slice(0, 10);
  });
  const calendar = [...jan, ...feb];
  const asset: number[] = [];
  for (let i = 0; i < calendar.length; i++) {
    if (i < 5) asset.push(100 + i * 2);
    else if (i < 10) asset.push(110 - (i - 4) * 8);
    else if (i < 31) asset.push(72);
    else asset.push(72 + (i - 31) * 1.5);
  }
  return {
    calendar,
    symbols: ["ASSET", "BENCH"],
    prices: { ASSET: asset, BENCH: calendar.map(() => 100) },
  };
}

describe("monthly halt reset — rientro a mercato", () => {
  it("dopo halt in gennaio, al primo rebalance di febbraio può rientrare (MONTHLY)", () => {
    const config: EventDrivenStrategyConfig = {
      sourceSignal: "MONTHLY_REENTRY",
      primaryTicker: "ASSET",
      benchmark: "BENCH",
      universe: ["ASSET"],
      baseCurrency: "USDC",
      rebalanceFrequency: "MONTHLY",
      takerFeeBps: 30,
      slippageBps: 5,
      risk: {
        maxDrawdownLimit: 0.12,
        stopLossPercentage: 0.99,
        trailingStop: false,
        liquidateToBaseOnMaxDrawdown: true,
      },
      signal: { kind: "buy_and_hold" },
    };

    const result = runEventDrivenBacktest({
      matrix: buildTwoMonthMatrix(),
      config,
      initialCash: 1,
    });

    const haltExit = result.trades.find((t) => t.reasonExit.includes("RISK_LIQUIDATION_MAX_DD"));
    expect(haltExit).toBeDefined();

    const febEntries = result.trades.filter((t) => t.entryDate >= "2024-02-01");
    expect(febEntries.length).toBeGreaterThanOrEqual(1);

    const lastEntry = febEntries[febEntries.length - 1];
    expect(lastEntry.entryDate.localeCompare("2024-02-01")).toBeGreaterThanOrEqual(0);
    expect(lastEntry.transactionFee).toBeGreaterThanOrEqual(0);
  });
});
