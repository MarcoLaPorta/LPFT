import { describe, expect, it } from "vitest";
import type { PriceMatrix } from "../market_data/types";
import {
  computeAsymmetricTrendMomentumWeights,
  emaAt,
  pickAsymmetricTrendMomentumTarget,
  type AsymmetricTrendMomentumConfig,
} from "./signal-engine";

const CFG: AsymmetricTrendMomentumConfig = {
  lookbackPeriodDays: 90,
  equitySmaPeriod: 100,
  cryptoEmaPeriod: 50,
  equityTicker: "QQQ",
  cryptoTicker: "BTC-USD",
  safeHavenTicker: "GLD",
};

function ramp(n: number, start: number, step: number): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

function flat(n: number, value: number): number[] {
  return Array.from({ length: n }, () => value);
}

function buildMatrix(
  qqq: number[],
  btc: number[],
  gld: number[],
): { matrix: PriceMatrix; dayIndex: number } {
  const n = Math.min(qqq.length, btc.length, gld.length);
  const calendar = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2020, 0, 1 + i));
    return d.toISOString().slice(0, 10);
  });
  return {
    matrix: {
      calendar,
      symbols: ["QQQ", "BTC-USD", "GLD"],
      prices: {
        QQQ: qqq.slice(0, n),
        "BTC-USD": btc.slice(0, n),
        GLD: gld.slice(0, n),
      },
    },
    dayIndex: n - 1,
  };
}

describe("signal-engine — ASYMMETRIC_TREND_MOMENTUM", () => {
  it("emaAt calcola EMA con seed SMA", () => {
    const series = ramp(60, 100, 1);
    const ema = emaAt(series, 59, 50);
    expect(ema).not.toBeNull();
    expect(ema!).toBeGreaterThan(series[0]);
  });

  it("alloca 100% QQQ se leader equity sopra SMA(100)", () => {
    const qqq = ramp(200, 80, 0.8);
    const btc = ramp(200, 200, 0.1);
    const gld = flat(200, 180);
    const { matrix, dayIndex } = buildMatrix(qqq, btc, gld);
    expect(pickAsymmetricTrendMomentumTarget(matrix, dayIndex, CFG)).toBe("QQQ");
  });

  it("alloca 100% BTC-USD se leader crypto sopra EMA(50)", () => {
    const qqq = ramp(200, 200, 0.05);
    const btc = ramp(200, 50, 1.2);
    const gld = flat(200, 180);
    const { matrix, dayIndex } = buildMatrix(qqq, btc, gld);
    expect(pickAsymmetricTrendMomentumTarget(matrix, dayIndex, CFG)).toBe("BTC-USD");
  });

  it("se il leader fallisce il filtro, usa il runner-up se sopra la sua media", () => {
    const qqq = [...ramp(150, 120, 0.5), ...flat(50, 90)];
    const btc = ramp(200, 40, 0.9);
    const gld = flat(200, 170);
    const { matrix, dayIndex } = buildMatrix(qqq, btc, gld);
    expect(pickAsymmetricTrendMomentumTarget(matrix, dayIndex, CFG)).toBe("BTC-USD");
  });

  it("se entrambi sotto le medie, alloca 100% GLD", () => {
    const qqq = [...ramp(120, 200, -0.6), ...flat(80, 50)];
    const btc = [...ramp(120, 300, -1.2), ...flat(80, 40)];
    const gld = flat(200, 175);
    const { matrix, dayIndex } = buildMatrix(qqq, btc, gld);
    expect(pickAsymmetricTrendMomentumTarget(matrix, dayIndex, CFG)).toBe("GLD");
  });

  it("computeAsymmetricTrendMomentumWeights imposta un solo peso a 1", () => {
    const qqq = ramp(200, 80, 0.8);
    const btc = ramp(200, 200, 0.1);
    const gld = flat(200, 180);
    const { matrix, dayIndex } = buildMatrix(qqq, btc, gld);
    const w = computeAsymmetricTrendMomentumWeights(matrix, dayIndex, ["QQQ", "BTC-USD", "GLD"], CFG);
    const held = Object.entries(w).filter(([, v]) => v > 0);
    expect(held).toHaveLength(1);
    expect(held[0][0]).toBe("QQQ");
    expect(held[0][1]).toBe(1);
  });
});
