import { describe, expect, it } from "vitest";
import { compileToHFTConfig, validateQuantStrategyInput } from "./afx-quant-compiler";
import { buildQuantitativeStrategySchema } from "./afx-quant-strategy-schema";

describe("HFT compiler", () => {
  const hftPayload = {
    intentClass: "HIGH_FREQUENCY_SCALPING",
    intentSummary: "Scalping ETH-USD su order book imbalance con stop stretto e latenza max 200ms.",
    universe: { assets: ["ETH-USD"], baseCurrency: "USDC" },
    hftLogic: {
      maxLatencyMs: 200,
      orderBookImbalanceTrigger: 0.62,
      microStopLossBps: 25,
      executionTimeoutSeconds: 120,
      targetProfitBps: 90,
      estimatedSpreadBps: 7,
    },
    riskManagement: {
      maxDrawdownLimit: 0.15,
      stopLossPercentage: 0.05,
      trailingStop: false,
      liquidateToBaseOnMaxDrawdown: true,
      slippageBps: 12,
      makerFeeBps: 0,
      takerFeeBps: 30,
    },
    backtest: { primaryTicker: "ETH-USD", benchmark: "^GSPC" },
    marketRoutingMode: "SECONDARY_AMM" as const,
  };

  it("valida payload HFT", () => {
    const v = validateQuantStrategyInput(hftPayload);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.data.marketRoutingMode).toBe("SECONDARY_AMM");
    }
  });

  it("compileToHFTConfig produce config tipizzata", () => {
    const v = validateQuantStrategyInput(hftPayload);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const cfg = compileToHFTConfig(v.data);
    expect(cfg.maxLatencyMs).toBe(200);
    expect(cfg.orderBookImbalanceTrigger).toBe(0.62);
    expect(cfg.primaryTicker).toBe("ETH-USD");
    expect(cfg.useLimitOrdersOnly).toBe(true);
    expect(cfg.slippageBps).toBe(12);
    expect(cfg.makerFeeBps).toBe(0);
    expect(cfg.takerFeeBps).toBe(30);
  });

  it("rifiuta taker con targetProfitBps troppo basso", () => {
    const v = validateQuantStrategyInput({
      ...hftPayload,
      hftLogic: { ...hftPayload.hftLogic, useLimitOrdersOnly: false, targetProfitBps: 50 },
    });
    expect(v.ok).toBe(false);
  });

  it("accetta payload HFT senza backtest.timeframe", () => {
    const v = validateQuantStrategyInput(hftPayload);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.data.backtest.timeframe).toBeUndefined();
    }
  });

  it("rifiuta strategia daily senza timeframe (schema Zod)", () => {
    const r = buildQuantitativeStrategySchema.safeParse({
      intentClass: "ALGORITHMIC_TRADING",
      intentSummary: "RSI mean reversion su SPY con stop loss e rebalance daily.",
      universe: { assets: ["SPY"], baseCurrency: "USDC" },
      algoLogic: { signal: "RSI", rsi: { period: 14 } },
      riskManagement: {
        maxDrawdownLimit: 0.2,
        stopLossPercentage: 0.08,
        trailingStop: false,
        liquidateToBaseOnMaxDrawdown: true,
        makerFeeBps: 0,
        takerFeeBps: 10,
        slippageBps: 2,
      },
      backtest: { primaryTicker: "SPY", benchmark: "^GSPC" },
    });
    expect(r.success).toBe(false);
  });
});
