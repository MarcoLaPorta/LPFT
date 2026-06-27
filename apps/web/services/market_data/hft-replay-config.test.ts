import { describe, expect, it } from "vitest";
import {
  buildHftReplaySessions,
  HFT_DEFAULT_LOOKBACK_DAYS,
  HFT_DEFAULT_MAX_SESSIONS,
  resolveHftReplayRange,
  sessionWindowSeconds,
} from "./hft-replay-config";

describe("buildHftReplaySessions", () => {
  it("genera una sessione per ogni giorno dell'ultimo mese (crypto 24h)", () => {
    const anchor = new Date("2026-05-20T12:00:00.000Z");
    const sessions = buildHftReplaySessions({
      lookbackDays: HFT_DEFAULT_LOOKBACK_DAYS,
      maxSessions: HFT_DEFAULT_MAX_SESSIONS,
      assetClass: "crypto",
      anchorEnd: anchor,
    });
    expect(sessions.length).toBeGreaterThanOrEqual(29);
    expect(sessions.length).toBeLessThanOrEqual(30);
    const first = sessions[0]!;
    expect(sessionWindowSeconds(first)).toBe(86_400);
    expect(first.end.getTime()).toBeLessThanOrEqual(anchor.getTime());
  });

  it("salta weekend per equity US (RTH 6.5h)", () => {
    const sessions = buildHftReplaySessions({
      lookbackDays: 14,
      maxSessions: 14,
      assetClass: "us_equity",
      anchorEnd: new Date("2026-05-20T12:00:00.000Z"),
    });
    for (const s of sessions) {
      const dow = s.start.getUTCDay();
      expect(dow).toBeGreaterThanOrEqual(1);
      expect(dow).toBeLessThanOrEqual(5);
      expect(sessionWindowSeconds(s)).toBe(6.5 * 3600);
    }
  });
});

describe("resolveHftReplayRange", () => {
  it("impone minimo 3600 secondi", () => {
    expect(resolveHftReplayRange(120).windowSeconds).toBe(3600);
    expect(resolveHftReplayRange(7200).windowSeconds).toBe(7200);
  });
});
