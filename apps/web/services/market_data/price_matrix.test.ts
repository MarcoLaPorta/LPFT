import { describe, expect, it } from "vitest";
import {
  alignSeriesToCalendar,
  buildMasterCalendar,
  buildPriceMatrix,
} from "./price_matrix";
import type { AdjCloseBar } from "./types";

describe("price_matrix — data alignment & forward-fill", () => {
  const assetA: AdjCloseBar[] = [
    { date: "2024-01-01", adjClose: 100, volume: 0 },
    { date: "2024-01-02", adjClose: 101, volume: 0 },
    { date: "2024-01-03", adjClose: 102, volume: 0 },
  ];

  const assetB: AdjCloseBar[] = [
    { date: "2024-01-01", adjClose: 200, volume: 0 },
    { date: "2024-01-03", adjClose: 204, volume: 0 },
  ];

  const calendar = buildMasterCalendar({ A: assetA, B: assetB });

  it("costruisce il master calendar con tutte le date uniche", () => {
    expect(calendar).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
  });

  it("forward-fill: Asset B al martedì riceve il adjClose del lunedì", () => {
    const alignedB = alignSeriesToCalendar(assetB, calendar);
    expect(alignedB[0]).toBe(200);
    expect(alignedB[1]).toBe(200);
    expect(alignedB[2]).toBe(204);
  });

  it("Asset A mantiene i prezzi originali senza alterazioni", () => {
    const alignedA = alignSeriesToCalendar(assetA, calendar);
    expect(alignedA).toEqual([100, 101, 102]);
  });

  it("buildPriceMatrix non contiene null né undefined in nessuna cella", () => {
    const matrix = buildPriceMatrix({ A: assetA, B: assetB });
    expect(matrix.calendar).toHaveLength(3);
    for (const sym of matrix.symbols) {
      const series = matrix.prices[sym];
      expect(series).toHaveLength(3);
      for (const px of series) {
        expect(px).not.toBeNull();
        expect(px).not.toBeUndefined();
        expect(typeof px).toBe("number");
        expect(Number.isFinite(px)).toBe(true);
      }
    }
  });

  it("forward-fill nella matrice completa: B[martedì] = B[lunedì]", () => {
    const matrix = buildPriceMatrix({ A: assetA, B: assetB });
    expect(matrix.prices.B[1]).toBe(matrix.prices.B[0]);
    expect(matrix.prices.B[1]).toBe(200);
  });
});
