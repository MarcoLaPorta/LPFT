import { describe, expect, it } from "vitest";
import { createInitialPortfolio, releaseMonthlyRiskHalt } from "./portfolio-state";

describe("releaseMonthlyRiskHalt", () => {
  it("ribasizza HWM all'equity corrente se inferiore al picco precedente", () => {
    const state = createInitialPortfolio(1);
    state.portfolioValue = 0.85;
    state.highWaterMark = 1.15;
    state.isHalted = true;
    state.safeMode = true;

    releaseMonthlyRiskHalt(state);

    expect(state.isHalted).toBe(false);
    expect(state.safeMode).toBe(false);
    expect(state.highWaterMark).toBe(0.85);
  });

  it("non abbassa HWM se equity è già al nuovo massimo", () => {
    const state = createInitialPortfolio(1);
    state.portfolioValue = 1.2;
    state.highWaterMark = 1.15;
    state.isHalted = true;

    releaseMonthlyRiskHalt(state);

    expect(state.highWaterMark).toBe(1.15);
  });
});
