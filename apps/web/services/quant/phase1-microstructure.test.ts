import { describe, expect, it } from "vitest";
import { almgrenChrissImpactBps, buyFillWithImpact } from "./trading-friction";
import { sampleGammaLatencyMs } from "./hft-latency";
import { SpreadToxicityGuard, spreadBpsFromBook } from "./hft-toxicity";
import { LimitQueuePositionEstimator } from "./hft-limit-queue";
import { HFTExecutionEngine } from "./hft-engine";
import type { HFTStrategyConfig } from "./hft-types";

describe("Phase 1 — Almgren-Chriss", () => {
  it("impatto cresce con √(order/liquidity)", () => {
    const small = almgrenChrissImpactBps({ orderSize: 10, l2Liquidity: 10_000 });
    const large = almgrenChrissImpactBps({ orderSize: 1000, l2Liquidity: 10_000 });
    expect(large).toBeGreaterThan(small);
    expect(buyFillWithImpact(100, 0, { orderSize: 100, l2Liquidity: 100 })).toBeGreaterThan(100);
  });
});

describe("Phase 1 — Gamma latency", () => {
  it("campiona latenza positiva con media ~25ms", () => {
    const samples = Array.from({ length: 200 }, () => sampleGammaLatencyMs({ meanMs: 25 }));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(samples.every((s) => s >= 0)).toBe(true);
    expect(mean).toBeGreaterThan(10);
    expect(mean).toBeLessThan(60);
  });
});

describe("Phase 1 — Spread toxicity", () => {
  it("sospende quando spread > μ+σ", () => {
    const guard = new SpreadToxicityGuard({ windowSize: 20, sigmaMultiplier: 1 });
    for (let i = 0; i < 15; i++) guard.observeSpreadBps(2);
    expect(guard.isToxic()).toBe(false);
    guard.observeSpreadBps(50);
    expect(guard.isToxic()).toBe(true);
    expect(spreadBpsFromBook(100, 100.05)).toBeCloseTo(5, 1);
  });
});

describe("Phase 1 — Limit queue", () => {
  it("fill quando la coda si svuota", () => {
    const q = new LimitQueuePositionEstimator();
    q.placeLimitOrder({
      orderId: "a",
      price: 10,
      side: "buy",
      size: 1,
      levelSize: 200,
      placedAt: 1,
    });
    const partial = q.applyTradedVolumeAtLevel(10, 2);
    expect(partial).toHaveLength(0);
    const filled = q.applyTradedVolumeAtLevel(10, 2);
    expect(filled).toContain("a");
  });
});

describe("Phase 1 — HFT engine toxicity halt", () => {
  it("ferma la sessione su spread tossico", async () => {
    const config: HFTStrategyConfig = {
      primaryTicker: "AAPL",
      benchmark: "SPY",
      universe: ["AAPL"],
      maxLatencyMs: 500,
      orderBookImbalanceTrigger: 0.6,
      microStopLossBps: 50,
      executionTimeoutSeconds: 60,
      targetProfitBps: 5,
      estimatedSpreadBps: 2,
      useLimitOrdersOnly: false,
      slippageBps: 4,
      makerFeeBps: 0,
      takerFeeBps: 0,
    };
    const engine = new HFTExecutionEngine(config);
    for (let i = 0; i < 30; i++) {
      await engine.onOrderBookUpdate({
        ts: i,
        bids: [{ price: 100, size: 100 }],
        asks: [{ price: 100.01, size: 100 }],
      });
    }
    await engine.onOrderBookUpdate({
      ts: 31,
      bids: [{ price: 100, size: 10 }],
      asks: [{ price: 102, size: 10 }],
    });
    const result = await engine.finalize(101);
    expect(result.halted).toBe(true);
    expect(result.haltReason).toMatch(/spread/i);
  });
});
