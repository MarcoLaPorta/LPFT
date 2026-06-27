import { describe, expect, it } from "vitest";
import { MarketDataError } from "./errors";
import { assertPriceMatrixReady, buildPriceMatrix } from "./price_matrix";
import type { AdjCloseBar } from "./types";

describe("assertPriceMatrixReady", () => {
  it("lancia MATRIX_INSUFFICIENT_DAYS se il calendario è troppo corto", () => {
    const a: AdjCloseBar[] = [
      { date: "2024-01-01", adjClose: 100, volume: 0 },
      { date: "2024-01-02", adjClose: 101, volume: 0 },
      { date: "2024-01-03", adjClose: 102, volume: 0 },
    ];
    const b: AdjCloseBar[] = [
      { date: "2024-01-01", adjClose: 200, volume: 0 },
      { date: "2024-01-03", adjClose: 204, volume: 0 },
    ];
    const matrix = buildPriceMatrix({ A: a, B: b });
    expect(() => assertPriceMatrixReady(matrix, ["A", "B"], 60)).toThrow(MarketDataError);
  });
});
