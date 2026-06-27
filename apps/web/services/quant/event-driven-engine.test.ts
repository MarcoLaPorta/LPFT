import { describe, expect, it } from "vitest";
import { runEventDrivenBacktest } from "./event-driven-engine";
import type { EventDrivenStrategyConfig } from "./types";
import type { PriceMatrix } from "../market_data/types";

/**
 * 5 giorni (Giorno 1…5):
 * - Giorni 1–2: rally (HWM → 1.15)
 * - Giorno 3: crollo ~-20% vs HWM → supera maxDrawdown 15%
 * - Giorni 4–5: prezzi scendono ma portafoglio resta in cash
 */
function buildCrashMatrix(): PriceMatrix {
  const calendar = [
    "2024-01-01",
    "2024-01-02",
    "2024-01-03",
    "2024-01-04",
    "2024-01-05",
  ];
  return {
    calendar,
    symbols: ["ASSET", "BENCH"],
    prices: {
      ASSET: [100, 110, 88, 85, 82],
      BENCH: [100, 100, 100, 100, 100],
    },
  };
}

function crashTestConfig(): EventDrivenStrategyConfig {
  return {
    sourceSignal: "TEST_BUY_HOLD",
    primaryTicker: "ASSET",
    benchmark: "BENCH",
    universe: ["ASSET"],
    baseCurrency: "USDC",
    rebalanceFrequency: "NONE",
    risk: {
      maxDrawdownLimit: 0.15,
      stopLossPercentage: 0.99,
      trailingStop: false,
      liquidateToBaseOnMaxDrawdown: true,
    },
    signal: { kind: "buy_and_hold" },
  };
}

describe("event-driven-engine — risk liquidation & safe mode", () => {
  const matrix = buildCrashMatrix();
  const config = crashTestConfig();

  it("queue il risk al Giorno 3 e liquida in T+1 al Giorno 4", () => {
    const result = runEventDrivenBacktest({ matrix, config, initialCash: 1 });

    expect(result.series).toHaveLength(5);

    const liquidationTrade = result.trades.find((t) =>
      t.reasonExit.includes("RISK_LIQUIDATION_MAX_DD"),
    );
    expect(liquidationTrade).toBeDefined();
    expect(liquidationTrade!.exitDate).toBe("2024-01-04");

    expect(liquidationTrade!.reasonExit).toContain("TEST_BUY_HOLD");
    expect(liquidationTrade!.reasonExit).toContain("RISK_LIQUIDATION_MAX_DD");
    expect(liquidationTrade!.symbol).toBe("ASSET");
    expect(liquidationTrade!.pnlFrac).toBeLessThan(0);
    expect(liquidationTrade!.pnlEquity).toBeLessThan(0);
  });

  it("dopo la liquidazione T+1, l'equity resta flat dal giorno successivo", () => {
    const result = runEventDrivenBacktest({ matrix, config, initialCash: 1 });

    const eqGiorno4 = result.series[3].equity;
    const eqGiorno5 = result.series[4].equity;
    expect(eqGiorno5).toBeCloseTo(eqGiorno4, 8);

    const reEntries = result.trades.filter((t) => t.entryDate >= "2024-01-04");
    expect(reEntries).toHaveLength(0);
  });

  it("non rientra in posizione dopo la liquidazione (isHalted)", () => {
    const result = runEventDrivenBacktest({ matrix, config, initialCash: 1 });
    expect(result.trades.filter((t) => t.entryDate >= "2024-01-04")).toHaveLength(0);
  });

  it("giorno 0: buy_and_hold apre almeno un trade senza halt immediato", () => {
    const calendar = ["2024-01-01", "2024-01-02", "2024-01-03"];
    const matrix: PriceMatrix = {
      calendar,
      symbols: ["ASSET", "BENCH"],
      prices: { ASSET: [100, 101, 102], BENCH: [100, 100, 100] },
    };
    const result = runEventDrivenBacktest({
      matrix,
      config: { ...crashTestConfig(), rebalanceFrequency: "NONE" },
      initialCash: 1,
    });
    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    expect(result.trades[0].entryDate).toBe("2024-01-02");
    const haltOnDay0 = result.trades.some(
      (t) => t.exitDate === "2024-01-01" && t.reasonExit.includes("RISK_LIQUIDATION_MAX_DD"),
    );
    expect(haltOnDay0).toBe(false);
  });

  it("registra un solo evento di uscita forzata per max drawdown nel trade journal", () => {
    const result = runEventDrivenBacktest({ matrix, config, initialCash: 1 });
    const maxDdExits = result.trades.filter((t) =>
      t.reasonExit.includes("RISK_LIQUIDATION_MAX_DD"),
    );
    expect(maxDdExits).toHaveLength(1);
  });
});
