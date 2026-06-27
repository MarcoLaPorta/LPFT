import { afterEach, describe, expect, it } from "vitest";
import { validateProposeExecution } from "./afx-execution-guard";

const originalAction = process.env.AFX_MAX_DRAWDOWN_ACTION;
const originalThreshold = process.env.AFX_MAX_DRAWDOWN_THRESHOLD;

afterEach(() => {
  if (originalAction === undefined) delete process.env.AFX_MAX_DRAWDOWN_ACTION;
  else process.env.AFX_MAX_DRAWDOWN_ACTION = originalAction;
  if (originalThreshold === undefined) delete process.env.AFX_MAX_DRAWDOWN_THRESHOLD;
  else process.env.AFX_MAX_DRAWDOWN_THRESHOLD = originalThreshold;
});

describe("validateProposeExecution", () => {
  it("blocca sharpe sotto soglia fiduciaria", () => {
    const out = validateProposeExecution({ sharpe: -0.8 });
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.reason).toContain("Sharpe -0.80 sotto soglia fiduciaria");
    }
  });

  it("accetta sharpe in soglia", () => {
    expect(validateProposeExecution({ sharpe: -0.5 })).toEqual({ ok: true });
    expect(validateProposeExecution({ sharpe: 0.4 })).toEqual({ ok: true });
  });

  it("emette warning su drawdown oltre soglia quando action=warn", () => {
    process.env.AFX_MAX_DRAWDOWN_ACTION = "warn";
    process.env.AFX_MAX_DRAWDOWN_THRESHOLD = "0.20";
    const out = validateProposeExecution({ maxDrawdown: 0.25 });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.warning).toContain("Max drawdown 25.0% oltre soglia 20.0%");
    }
  });
});
