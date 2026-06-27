import { describe, expect, it } from "vitest";
import {
  buildQuantitativeStrategyToolSchema,
  normalizeQuantStrategyPayload,
  parseQuantStrategyPayload,
  unwrapMisnestedStrategyPayload,
} from "./afx-payload-normalize";

describe("afx-payload-normalize", () => {
  it("normalizza MACRO_REGIME_BREAKOUT e risk_management snake_case", () => {
    const raw = {
      intentClass: "ALGORITHMIC_TRADING",
      intentSummary: "Macro Regime Breakout su multi-asset con rotazione mensile del rischio.",
      universe: { assets: ["SPY", "TLT"], base_currency: "USDC" },
      risk_management: {
        max_drawdown_limit: 0.15,
        stop_loss_percentage: 0.1,
        trailing_stop: true,
      },
      algoLogic: { signal: "Macro Regime Breakout" },
      backtest: { primary_ticker: "SPY", benchmark: "^GSPC", timeframe: "2y" },
    };
    const parsed = parseQuantStrategyPayload(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.algoLogic?.signal).toBe("MACRO_REGIME_BREAKOUT");
    expect(parsed.data.riskManagement.maxDrawdownLimit).toBe(0.15);
  });

  it("unwrap payload HFT annidato per errore in algoLogic", () => {
    const misnested = {
      algoLogic: {
        intentClass: "HIGH_FREQUENCY_SCALPING",
        intentSummary:
          "Strategia di market making HFT su ETH-USD con ordini Limit e OBI monitoring.",
        universe: { assets: ["ETH-USD"], baseCurrency: "USDC" },
        hftLogic: {
          maxLatencyMs: 50,
          orderBookImbalanceTrigger: 0.65,
          microStopLossBps: 25,
          targetProfitBps: 12,
          executionTimeoutSeconds: 30,
          useLimitOrdersOnly: true,
          estimatedSpreadBps: 6,
          replayLookbackDays: 30,
          replayMaxSessions: 30,
        },
        riskManagement: {
          maxDrawdownLimit: 0.08,
          stopLossPercentage: 0.02,
          trailingStop: false,
          liquidateToBaseOnMaxDrawdown: true,
          takerFeeRate: 0.0005,
          slippageBps: 2,
        },
        marketRoutingMode: "SECONDARY_AMM",
      },
    };

    const unwrapped = unwrapMisnestedStrategyPayload(misnested);
    expect(unwrapped).toMatchObject({
      intentClass: "HIGH_FREQUENCY_SCALPING",
      universe: { assets: ["ETH-USD"] },
    });
    expect((unwrapped as Record<string, unknown>).algoLogic).toBeUndefined();

    const parsed = parseQuantStrategyPayload(misnested);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.intentClass).toBe("HIGH_FREQUENCY_SCALPING");
    expect(parsed.data.backtest.primaryTicker).toBe("ETH-USD");
    expect(parsed.data.hftLogic?.targetProfitBps).toBe(12);
    expect(parsed.data.riskManagement.takerFeeBps).toBe(5);
  });

  it("buildQuantitativeStrategyToolSchema accetta payload misnested prima di execute", () => {
    const misnested = {
      algoLogic: {
        intentClass: "HIGH_FREQUENCY_SCALPING",
        intentSummary: "HFT ETH scalping con limit maker e stop taker.",
        universe: { assets: ["ETH-USD"], baseCurrency: "USDC" },
        hftLogic: {
          maxLatencyMs: 50,
          orderBookImbalanceTrigger: 0.65,
          microStopLossBps: 25,
          targetProfitBps: 12,
          estimatedSpreadBps: 6,
        },
        riskManagement: {
          maxDrawdownLimit: 0.08,
          stopLossPercentage: 0.02,
          trailingStop: false,
          liquidateToBaseOnMaxDrawdown: true,
          takerFeeRate: 0.0005,
          slippageBps: 2,
        },
        marketRoutingMode: "SECONDARY_AMM",
      },
    };
    const result = buildQuantitativeStrategyToolSchema.safeParse(misnested);
    expect(result.success).toBe(true);
  });
});
