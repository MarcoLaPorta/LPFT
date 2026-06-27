import { describe, expect, it } from "vitest";
import { computeHftSessionMetrics, buildHftEquitySeries } from "./hft-metrics";
import type { HFTSessionResult } from "./hft-types";

function session(trades: HFTSessionResult["trades"]): HFTSessionResult {
  return {
    ticksProcessed: 100,
    bookUpdates: 50,
    trades,
    totalPnlBps: trades.reduce((s, t) => s + t.pnlBps, 0),
    halted: false,
    avgLatencyMs: 22,
  };
}

describe("computeHftSessionMetrics", () => {
  it("calcola win rate e PnL sessione", () => {
    const m = computeHftSessionMetrics(
      session([
        {
          tradeIndex: 1,
          entryTs: 1,
          exitTs: 2,
          entryPrice: 100,
          exitPrice: 100.2,
          side: "long",
          pnlBps: 20,
          reasonEntry: "maker_limit_filled",
          reasonExit: "target_profit",
        },
        {
          tradeIndex: 2,
          entryTs: 3,
          exitTs: 4,
          entryPrice: 100,
          exitPrice: 99.9,
          side: "long",
          pnlBps: -10,
          reasonEntry: "taker_market_bid",
          reasonExit: "micro_stop_loss",
        },
      ]),
    );
    expect(m.sessionPnLBps).toBe(10);
    expect(m.tradeCount).toBe(2);
    expect(m.winRate).toBe(0.5);
    expect(m.avgWinBps).toBe(20);
    expect(m.avgLossBps).toBe(-10);
    expect(m.profitFactor).toBe(2);
  });

  it("buildHftEquitySeries compone equity da scalp", () => {
    const series = buildHftEquitySeries([
      {
        tradeIndex: 1,
        entryTs: Date.UTC(2026, 4, 20, 10, 0),
        exitTs: Date.UTC(2026, 4, 20, 10, 1),
        entryPrice: 100,
        exitPrice: 100.1,
        side: "long",
        pnlBps: 10,
        reasonEntry: "maker",
        reasonExit: "target",
      },
    ]);
    expect(series.length).toBe(2);
    expect(series[1].equity).toBeCloseTo(1.001, 6);
  });

  it("buildHftEquitySeries assegna chartTime univoci per scalp nello stesso giorno", () => {
    const day = Date.UTC(2026, 4, 20, 14, 0);
    const series = buildHftEquitySeries([
      {
        tradeIndex: 1,
        entryTs: day,
        exitTs: day + 60_000,
        entryPrice: 100,
        exitPrice: 100.1,
        side: "long",
        pnlBps: 10,
        reasonEntry: "maker",
        reasonExit: "target",
      },
      {
        tradeIndex: 2,
        entryTs: day + 120_000,
        exitTs: day + 180_000,
        entryPrice: 100,
        exitPrice: 99.9,
        side: "long",
        pnlBps: -10,
        reasonEntry: "maker",
        reasonExit: "stop",
      },
    ]);
    const times = series.map((p) => p.chartTime);
    expect(times.every((t) => t != null)).toBe(true);
    expect(new Set(times).size).toBe(times.length);
    expect(series[0].date).toBe(series[1].date);
  });
});
