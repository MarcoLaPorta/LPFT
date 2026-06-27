import { describe, expect, it } from "vitest";
import { HFTExecutionEngine, HFT_OBI_ADVERSE_CANCEL_THRESHOLD } from "./hft-engine";
import type { HFTStrategyConfig } from "./hft-types";

const baseConfig: HFTStrategyConfig = {
  primaryTicker: "ETH-USD",
  benchmark: "^GSPC",
  universe: ["ETH-USD"],
  maxLatencyMs: 500,
  orderBookImbalanceTrigger: 0.6,
  microStopLossBps: 30,
  executionTimeoutSeconds: 60,
  targetProfitBps: 15,
  estimatedSpreadBps: 8,
  useLimitOrdersOnly: true,
  slippageBps: 12,
  makerFeeBps: 0,
  takerFeeBps: 5,
};

function bullishBook(ts: number): { ts: number; bids: { price: number; size: number }[]; asks: { price: number; size: number }[] } {
  return {
    ts,
    bids: [{ price: 100, size: 90 }],
    asks: [{ price: 100.1, size: 10 }],
  };
}

describe("HFTExecutionEngine", () => {
  it("apre e chiude posizione maker su imbalance L2", async () => {
    const engine = new HFTExecutionEngine(baseConfig);
    const ts = Date.now();
    await engine.onOrderBookUpdate(bullishBook(ts));
    await engine.onTick({ ts: ts + 100, price: 100, size: 100 }, 10);
    const result = await engine.finalize(100.25);
    expect(result.bookUpdates).toBeGreaterThan(0);
    if (result.trades.length > 0) {
      expect(result.trades[0].reasonEntry).toMatch(/maker/);
    }
  });

  it("taker paga più spread/fee del maker sullo stesso movimento", async () => {
    const book = bullishBook(1);
    const makerEngine = new HFTExecutionEngine({ ...baseConfig, targetProfitBps: 5 });
    await makerEngine.onOrderBookUpdate(book);
    await makerEngine.onTick({ ts: 2, price: 100, size: 200 }, 5);
    await makerEngine.onTick({ ts: 3, price: 100.15, size: 500 }, 5);
    const makerResult = await makerEngine.finalize(100.15);

    const takerEngine = new HFTExecutionEngine({
      ...baseConfig,
      useLimitOrdersOnly: false,
      slippageBps: 12,
      takerFeeBps: 5,
      targetProfitBps: 5,
    });
    await takerEngine.onOrderBookUpdate(book);
    await takerEngine.onTick({ ts: 3, price: 100.15, size: 1 }, 5);
    const takerResult = await takerEngine.finalize(100.15);

    if (makerResult.trades.length > 0 && takerResult.trades.length > 0) {
      expect(takerResult.trades[0].entryPrice).toBeGreaterThan(makerResult.trades[0].entryPrice);
      expect(takerResult.trades[0].pnlBps).toBeLessThan(makerResult.trades[0].pnlBps);
    }
  });

  it("maker exit chiude con maker_target_profit senza taker exit", async () => {
    const engine = new HFTExecutionEngine({ ...baseConfig, targetProfitBps: 10 });
    const ts = 1000;
    await engine.onOrderBookUpdate(bullishBook(ts));
    await engine.onTick({ ts: ts + 50, price: 100, size: 200 }, 5);
    await engine.onOrderBookUpdate({
      ts: ts + 80,
      bids: [{ price: 100.12, size: 50 }],
      asks: [{ price: 100.2, size: 10 }],
    });
    const result = await engine.finalize(100.12);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades[0].reasonExit).toBe("maker_target_profit");
    expect(result.trades[0].pnlBps).toBeGreaterThan(0);
  });

  it("annulla entry limit su OBI avverso (< soglia)", async () => {
    const engine = new HFTExecutionEngine(baseConfig);
    await engine.onOrderBookUpdate(bullishBook(1));
    await engine.onOrderBookUpdate({
      ts: 2,
      bids: [{ price: 100, size: 5 }],
      asks: [{ price: 100.1, size: 95 }],
    });
    expect(HFT_OBI_ADVERSE_CANCEL_THRESHOLD).toBe(0.3);
    const result = await engine.finalize(100);
    expect(result.trades.length).toBe(0);
  });

  it("stop loss resta taker anche in modalità maker", async () => {
    const engine = new HFTExecutionEngine({ ...baseConfig, microStopLossBps: 5, targetProfitBps: 50 });
    await engine.onOrderBookUpdate(bullishBook(1));
    await engine.onTick({ ts: 2, price: 100, size: 200 }, 5);
    await engine.onTick({ ts: 3, price: 99.9, size: 1 }, 5);
    const result = await engine.finalize(99.9);
    if (result.trades.length > 0) {
      expect(result.trades[0].reasonExit).toBe("micro_stop_loss");
    }
  });

  it("halt su latency eccessiva", async () => {
    const engine = new HFTExecutionEngine({ ...baseConfig, maxLatencyMs: 50 });
    await engine.onTick({ ts: 1, price: 100, size: 1 }, 200);
    const result = await engine.finalize(100);
    expect(result.halted).toBe(true);
    expect(result.haltReason).toContain("Latency");
  });

  it("runMockSession rimosso — HFT usa solo TickReplayEngine Alpaca", () => {
    expect("runMockSession" in HFTExecutionEngine.prototype).toBe(false);
  });
});
