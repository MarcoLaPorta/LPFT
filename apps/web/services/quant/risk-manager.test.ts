import { describe, expect, it } from "vitest";
import { computePortfolioDrawdown, evaluatePortfolioRisk } from "./risk-manager";
import type { EventDrivenStrategyConfig, PortfolioState } from "./types";

function baseState(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    currentDate: "2024-01-03",
    cash: 0,
    positions: { ASSET: 0.01 },
    portfolioValue: 0.92,
    highWaterMark: 1.15,
    safeMode: false,
    isHalted: false,
    entryPrices: { ASSET: 100 },
    ...overrides,
  };
}

function baseConfig(overrides?: Partial<EventDrivenStrategyConfig["risk"]>): EventDrivenStrategyConfig {
  return {
    sourceSignal: "TEST_STRATEGY",
    primaryTicker: "ASSET",
    benchmark: "BENCH",
    universe: ["ASSET"],
    baseCurrency: "USDC",
    rebalanceFrequency: "NONE",
    risk: {
      maxDrawdownLimit: 0.15,
      stopLossPercentage: 0.1,
      trailingStop: false,
      liquidateToBaseOnMaxDrawdown: true,
      ...overrides,
    },
    signal: { kind: "buy_and_hold" },
  };
}

describe("risk-manager", () => {
  it("max drawdown → halt_portfolio (circuit breaker)", () => {
    const result = evaluatePortfolioRisk(
      baseState(),
      { ASSET: 92, BENCH: 100 },
      baseConfig(),
    );
    expect(result.kind).toBe("halt_portfolio");
    if (result.kind === "halt_portfolio") {
      expect(result.reason).toContain("RISK_LIQUIDATION_MAX_DD");
    }
  });

  it("stop-loss → close_position senza halt", () => {
    const result = evaluatePortfolioRisk(
      baseState({ portfolioValue: 1.05, highWaterMark: 1.1, entryPrices: { ASSET: 100 } }),
      { ASSET: 88, BENCH: 100 },
      baseConfig({ maxDrawdownLimit: 0.5 }),
    );
    expect(result.kind).toBe("close_position");
    if (result.kind === "close_position") {
      expect(result.symbol).toBe("ASSET");
      expect(result.reason).toContain("RISK_LIQUIDATION_STOP_LOSS");
    }
  });

  it("computePortfolioDrawdown ritorna null se HWM è 0", () => {
    const dd = computePortfolioDrawdown(
      baseState({ highWaterMark: 0, portfolioValue: 1 }),
    );
    expect(dd).toBeNull();
  });

  it("nessun halt_portfolio al giorno 0 con HWM appena seedato", () => {
    const state = baseState({ portfolioValue: 1, highWaterMark: 1 });
    const result = evaluatePortfolioRisk(state, { ASSET: 100, BENCH: 100 }, baseConfig());
    expect(result.kind).not.toBe("halt_portfolio");
  });

  it("nessun trigger sotto soglia", () => {
    const result = evaluatePortfolioRisk(
      baseState({ portfolioValue: 1.1, highWaterMark: 1.15 }),
      { ASSET: 110, BENCH: 100 },
      baseConfig(),
    );
    expect(result.kind).toBe("none");
  });
});
