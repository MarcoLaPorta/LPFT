import { describe, expect, it } from "vitest";
import { toAscChartLineData } from "./chart-time";
import type { BacktestPointView } from "./afx-analysis-types";

describe("toAscChartLineData", () => {
  it("risolve date duplicate con bump +1s", () => {
    const points: BacktestPointView[] = [
      { date: "2026-05-20", equity: 1, benchmark: 1 },
      { date: "2026-05-20", equity: 1.001, benchmark: 1 },
      { date: "2026-05-21", equity: 1.002, benchmark: 1 },
    ];
    const line = toAscChartLineData(points, (p) => p.equity);
    expect(line[0].time).toBeLessThan(line[1].time as number);
    expect(line[1].time).toBeLessThan(line[2].time as number);
  });
});
