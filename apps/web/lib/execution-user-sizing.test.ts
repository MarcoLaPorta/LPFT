import { describe, expect, it } from "vitest";
import {
  displayUsdcToRaw,
  mergeUserSizingIntoPayload,
  rawUsdcToDisplay,
} from "./execution-user-sizing";

describe("execution-user-sizing", () => {
  it("rawUsdcToDisplay formats 6 decimals", () => {
    expect(rawUsdcToDisplay("1000000")).toBe("1");
    expect(rawUsdcToDisplay("1500000")).toBe("1.5");
    expect(rawUsdcToDisplay("0")).toBe("0");
  });

  it("displayUsdcToRaw parses human input", () => {
    expect(displayUsdcToRaw("10.5")).toBe(10_500_000n);
    expect(displayUsdcToRaw("0")).toBe(null);
  });

  it("mergeUserSizingIntoPayload overwrites amountIn", () => {
    const base = {
      sizing: {
        amountIn: "5000000",
        tokenIn: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
        tokenOut: "0x4200000000000000000000000000000000000006",
        fee: 3000,
      },
    };
    const out = mergeUserSizingIntoPayload(base, {
      amountIn: "2000000",
    });
    expect("payload" in out).toBe(true);
    if ("payload" in out) {
      const s = out.payload.sizing as { amountIn: string; userConfirmed?: boolean };
      expect(s.amountIn).toBe("2000000");
      expect(s.userConfirmed).toBe(true);
    }
  });
});
