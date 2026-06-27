import { describe, expect, it } from "vitest";
import { runEventDrivenBacktest } from "./event-driven-engine";
import type { EventDrivenStrategyConfig } from "./types";
import type { PriceMatrix } from "../market_data/types";

/**
 * Con rebalance NONE, l'halt resta attivo fino a fine campione (nessun reset mensile).
 */
function buildHaltTrapMatrix(): PriceMatrix {
  const calendar = Array.from({ length: 10 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i));
    return d.toISOString().slice(0, 10);
  });
  return {
    calendar,
    symbols: ["ASSET", "BENCH"],
    prices: {
      ASSET: [100, 110, 115, 88, 100, 100, 100, 100, 100, 100],
      BENCH: Array(10).fill(100),
    },
  };
}

describe("isHalted — sospensione risk", () => {
  it("con rebalance NONE: dopo max-DD nessun rientro fino a fine backtest", () => {
    const config: EventDrivenStrategyConfig = {
      sourceSignal: "HALT_HOLD",
      primaryTicker: "ASSET",
      benchmark: "BENCH",
      universe: ["ASSET"],
      baseCurrency: "USDC",
      rebalanceFrequency: "NONE",
      takerFeeBps: 100,
      risk: {
        maxDrawdownLimit: 0.15,
        stopLossPercentage: 0.99,
        trailingStop: false,
        liquidateToBaseOnMaxDrawdown: true,
      },
      signal: { kind: "buy_and_hold" },
    };

    const result = runEventDrivenBacktest({
      matrix: buildHaltTrapMatrix(),
      config,
      initialCash: 1,
    });

    const maxDdExit = result.trades.find((t) => t.reasonExit.includes("RISK_LIQUIDATION_MAX_DD"));
    expect(maxDdExit).toBeDefined();
    expect(maxDdExit!.exitDate).toBe("2024-01-05");

    const entriesAfterHalt = result.trades.filter((t) => t.entryDate > maxDdExit!.exitDate);
    expect(entriesAfterHalt).toHaveLength(0);

    const eqAfter = result.series.slice(4).map((p) => p.equity);
    for (let i = 1; i < eqAfter.length; i++) {
      expect(eqAfter[i]).toBeCloseTo(eqAfter[0], 8);
    }
  });
});
