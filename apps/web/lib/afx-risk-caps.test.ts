import { describe, expect, it } from "vitest";
import { parseRiskCaps, resolveRiskCapsApplied } from "./afx-risk-caps";

describe("afx-risk-caps", () => {
  it("parseRiskCaps accetta snake_case", () => {
    const caps = parseRiskCaps({
      max_drawdown_limit: 0.12,
      stop_loss_percentage: 0.08,
      trailing_stop: true,
    });
    expect(caps).toEqual({
      maxDrawdownLimit: 0.12,
      stopLossPercentage: 0.08,
      trailingStop: true,
    });
  });

  it("resolveRiskCapsApplied legge riskManagement da compiledStrategy", () => {
    const caps = resolveRiskCapsApplied(undefined, {
      riskManagement: {
        maxDrawdownLimit: 0.15,
        stopLossPercentage: 0.1,
        trailingStop: false,
      },
    });
    expect(caps?.maxDrawdownLimit).toBe(0.15);
  });
});
