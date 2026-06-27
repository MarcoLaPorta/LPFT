import type { HFTExecutionEngine } from "../quant/hft-engine";
import type { HFTSessionResult } from "../quant/hft-types";
import { MarketDataError } from "./errors";
import type { HftReplaySessionWindow } from "./hft-replay-config";
import { sessionWindowSeconds } from "./hft-replay-config";
import { TickReplayEngine, type TickReplayStats } from "./tick-replay-engine";

export type MultiSessionHftReplayStats = {
  lookbackDays: number;
  maxSessions: number;
  sessionsPlanned: number;
  sessionsRun: number;
  sessionsSkipped: number;
  totalEvents: number;
  spanMsFirst: string | null;
  spanMsLast: string | null;
  perSession: TickReplayStats[];
};

export type MultiSessionHftReplayResult = {
  session: HFTSessionResult;
  stats: MultiSessionHftReplayStats;
};

function mergeHftSessionResults(results: HFTSessionResult[]): HFTSessionResult {
  const trades = results.flatMap((r) => r.trades);
  const ticksProcessed = results.reduce((s, r) => s + r.ticksProcessed, 0);
  const bookUpdates = results.reduce((s, r) => s + r.bookUpdates, 0);
  const latencyWeighted =
    results.reduce((s, r) => s + r.avgLatencyMs * Math.max(1, r.ticksProcessed), 0) /
    Math.max(1, ticksProcessed);
  const halted = results.some((r) => r.halted);
  const haltReason = results.find((r) => r.halted)?.haltReason;

  let tradeSeq = 0;
  const reindexed = trades
    .sort((a, b) => a.entryTs - b.entryTs)
    .map((t) => ({ ...t, tradeIndex: ++tradeSeq }));

  return {
    ticksProcessed,
    bookUpdates,
    trades: reindexed,
    totalPnlBps: reindexed.reduce((s, t) => s + t.pnlBps, 0),
    halted,
    haltReason,
    avgLatencyMs: latencyWeighted,
  };
}

function isEmptySeriesError(e: unknown): boolean {
  return (
    e instanceof MarketDataError &&
    (e.code === "TICKER_EMPTY_SERIES" || e.code === "TICKER_INSUFFICIENT_BARS")
  );
}

/**
 * Esegue N sessioni replay tick/L2 su orizzonte storico e aggrega trade + metriche.
 */
export async function runMultiSessionHftReplay(input: {
  symbol: string;
  sessions: HftReplaySessionWindow[];
  lookbackDays: number;
  maxSessions: number;
  createEngine: (sessionSeconds: number) => HFTExecutionEngine;
}): Promise<MultiSessionHftReplayResult> {
  const replay = new TickReplayEngine();
  const perSessionStats: TickReplayStats[] = [];
  const sessionResults: HFTSessionResult[] = [];
  let sessionsSkipped = 0;
  let totalEvents = 0;

  for (const win of input.sessions) {
    const sessionSeconds = sessionWindowSeconds(win);
    const engine = input.createEngine(sessionSeconds);
    try {
      const stats = await replay.replayToEngine(engine, {
        symbol: input.symbol,
        start: win.start,
        end: win.end,
        speed: 0,
      });
      const result = await engine.finalize(engine.getLastObservedPrice());
      perSessionStats.push(stats);
      sessionResults.push(result);
      totalEvents += stats.eventCount;
    } catch (e) {
      if (isEmptySeriesError(e)) {
        sessionsSkipped += 1;
        continue;
      }
      throw e;
    }
  }

  if (sessionResults.length === 0) {
    throw new MarketDataError(
      "TICKER_EMPTY_SERIES",
      `Nessuna sessione HFT con tick/quote Alpaca per ${input.symbol.toUpperCase()} negli ultimi ${input.lookbackDays} giorni ` +
        `(${input.sessions.length} finestre campionate). Verifica ALPACA_DATA_BASE_URL=https://data.alpaca.markets e piano dati crypto.`,
      { symbol: input.symbol, sessionsPlanned: input.sessions.length },
    );
  }

  const merged = mergeHftSessionResults(sessionResults);
  const first = perSessionStats[0];
  const last = perSessionStats[perSessionStats.length - 1];

  return {
    session: merged,
    stats: {
      lookbackDays: input.lookbackDays,
      maxSessions: input.maxSessions,
      sessionsPlanned: input.sessions.length,
      sessionsRun: sessionResults.length,
      sessionsSkipped,
      totalEvents,
      spanMsFirst: first?.windowStart ?? null,
      spanMsLast: last?.windowEnd ?? null,
      perSession: perSessionStats,
    },
  };
}
