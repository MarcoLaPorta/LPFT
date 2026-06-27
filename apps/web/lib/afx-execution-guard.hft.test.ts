import { describe, expect, it } from "vitest";
import { validateProposeExecution } from "./afx-execution-guard";

describe("validateProposeExecution HFT", () => {
  it("rifiuta PRIMARY_MINT_BURN per HIGH_FREQUENCY_SCALPING", () => {
    const out = validateProposeExecution({
      intentClass: "HIGH_FREQUENCY_SCALPING",
      marketRoutingMode: "PRIMARY_MINT_BURN",
      estimatedSpreadBps: 5,
      targetProfitBps: 15,
    });
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.reason).toContain("SECONDARY_AMM");
    }
  });

  it("rifiuta se spread >= target profit", () => {
    const out = validateProposeExecution({
      intentClass: "HIGH_FREQUENCY_SCALPING",
      marketRoutingMode: "SECONDARY_AMM",
      estimatedSpreadBps: 20,
      targetProfitBps: 12,
    });
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.reason).toContain("Spread stimato");
    }
  });

  it("accetta SECONDARY_AMM con edge positivo", () => {
    const out = validateProposeExecution({
      intentClass: "HIGH_FREQUENCY_SCALPING",
      marketRoutingMode: "SECONDARY_AMM",
      estimatedSpreadBps: 6,
      targetProfitBps: 15,
    });
    expect(out.ok).toBe(true);
  });
});
