import { describe, expect, it, vi, afterEach } from "vitest";
import { TickReplayEngine } from "./tick-replay-engine";
import { HFTExecutionEngine } from "../quant/hft-engine";
import { HFT_MIN_REPLAY_SPAN_MS } from "./hft-replay-config";

const baseConfig = {
  primaryTicker: "SPY",
  benchmark: "^GSPC",
  universe: ["SPY"],
  maxLatencyMs: 500,
  orderBookImbalanceTrigger: 0.6,
  microStopLossBps: 30,
  executionTimeoutSeconds: 3600,
  targetProfitBps: 15,
  estimatedSpreadBps: 8,
  useLimitOrdersOnly: true,
  slippageBps: 4,
  makerFeeBps: 0,
  takerFeeBps: 0,
};

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe("TickReplayEngine", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rifiuta replay senza credenziali Alpaca", async () => {
    vi.stubEnv("ALPACA_API_KEY", "");
    vi.stubEnv("ALPACA_API_SECRET", "");
    const replay = new TickReplayEngine();
    await expect(
      replay.replayToEngine(new HFTExecutionEngine(baseConfig), {
        symbol: "SPY",
        start: new Date(Date.now() - 3_600_000),
        end: new Date(),
      }),
    ).rejects.toThrow(/ALPACA_API_KEY/);
  });

  it("carica eventi paginati e richiede span minimo 1h", async () => {
    vi.stubEnv("ALPACA_API_KEY", "test-key");
    vi.stubEnv("ALPACA_API_SECRET", "test-secret");
    vi.stubEnv("ALPACA_PAPER", "true");

    const t0 = Date.UTC(2026, 4, 19, 14, 0, 0);
    const quotes = Array.from({ length: 120 }, (_, i) => ({
      t: iso(t0 + i * 60_000),
      bp: 500 + i * 0.01,
      ap: 500.02 + i * 0.01,
      bs: 100,
      as: 90,
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/quotes")) {
        return new Response(JSON.stringify({ quotes, next_page_token: undefined }), { status: 200 });
      }
      if (url.includes("/trades")) {
        return new Response(JSON.stringify({ trades: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const replay = new TickReplayEngine();
    const stats = await replay.replayToEngine(new HFTExecutionEngine(baseConfig), {
      symbol: "SPY",
      start: new Date(t0),
      end: new Date(t0 + HFT_MIN_REPLAY_SPAN_MS + 60_000),
      speed: 0,
    });

    expect(stats.eventCount).toBeGreaterThan(100);
    expect(stats.spanMs).toBeGreaterThanOrEqual(HFT_MIN_REPLAY_SPAN_MS);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/quotes"))).toBe(true);
  });

  it("rifiuta span inferiore a 1 ora", async () => {
    vi.stubEnv("ALPACA_API_KEY", "test-key");
    vi.stubEnv("ALPACA_API_SECRET", "test-secret");

    const t0 = Date.UTC(2026, 4, 19, 14, 0, 0);
    const quotes = [
      { t: iso(t0), bp: 500, ap: 500.02, bs: 10, as: 10 },
      { t: iso(t0 + 15 * 60_000), bp: 501, ap: 501.02, bs: 10, as: 10 },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/quotes")) {
          return new Response(JSON.stringify({ quotes }), { status: 200 });
        }
        return new Response(JSON.stringify({ trades: [] }), { status: 200 });
      }),
    );

    const replay = new TickReplayEngine();
    await expect(
      replay.replayToEngine(new HFTExecutionEngine(baseConfig), {
        symbol: "SPY",
        start: new Date(t0),
        end: new Date(t0 + 3_600_000),
      }),
    ).rejects.toThrow(/copertura/i);
  });
});
