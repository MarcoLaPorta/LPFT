import { tool } from "ai";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { getSigner } from "./services/signer";
import { fetchHistoricalOhlcv, fetchPairedHistory } from "../services/market_data";
import {
  projectForwardFromCloses,
  runStrategyBacktest,
  type StrategySpec,
} from "../services/quant/backtest";

const timeframeSchema = z.enum(["1y", "2y", "5y"]);

function timeframeToRange(tf: z.infer<typeof timeframeSchema>): { period1: Date; period2: Date } {
  const period2 = new Date();
  const period1 = new Date(period2);
  if (tf === "1y") period1.setUTCFullYear(period1.getUTCFullYear() - 1);
  else if (tf === "2y") period1.setUTCFullYear(period1.getUTCFullYear() - 2);
  else period1.setUTCFullYear(period1.getUTCFullYear() - 5);
  return { period1, period2 };
}

const marketRoutingSchema = z.enum(["PRIMARY_MINT_BURN", "PRIMARY_RFQ_ATOMIC", "SECONDARY_AMM"]);

export function createAfxChatTools(ctx: { userId: string }) {
  const { userId } = ctx;

  const analyzeMarketData = tool({
    description:
      "Scarica storico OHLCV reale (Yahoo Finance) per un ticker e restituisce sintesi (ultimo close, conteggio barre, campione).",
    inputSchema: z.object({
      ticker: z.string().describe("Simbolo Yahoo, es. AAPL, MSFT, ^GSPC"),
      timeframe: timeframeSchema.describe("Finestra storica"),
    }),
    execute: async ({ ticker, timeframe }) => {
      const { period1, period2 } = timeframeToRange(timeframe);
      const bars = await fetchHistoricalOhlcv(ticker.toUpperCase(), { period1, period2 });
      if (bars.length === 0) {
        return { error: "Nessun dato", ticker, timeframe };
      }
      const last = bars[bars.length - 1];
      const closes = bars.map((b) => b.close);
      const sum = closes.reduce((a, b) => a + b, 0);
      return {
        ticker: ticker.toUpperCase(),
        timeframe,
        barCount: bars.length,
        firstDate: bars[0].date,
        lastDate: last.date,
        lastClose: last.close,
        meanClose: sum / closes.length,
        sampleTail: bars.slice(-5),
      };
    },
  });

  const runStrategyBacktestTool = tool({
    description:
      "Esegue backtest su dati Yahoo allineati al benchmark: equity vs benchmark, metriche (CAGR, Sharpe, max DD), proiezioni 30/90/365 giorni.",
    inputSchema: z.object({
      ticker: z.string(),
      benchmark: z.string().default("^GSPC"),
      timeframe: timeframeSchema,
      strategy: z.enum(["buy_and_hold", "drawdown_to_stable"]).default("buy_and_hold"),
      maxDrawdownFrac: z.number().min(0.02).max(0.5).optional(),
      reentrySmaDays: z.number().int().min(5).max(200).optional(),
    }),
    execute: async (input) => {
      const { period1, period2 } = timeframeToRange(input.timeframe);
      const sym = input.ticker.toUpperCase();
      const bench = (input.benchmark ?? "^GSPC").toUpperCase();
      const { aligned } = await fetchPairedHistory(sym, bench, { period1, period2 });
      const strategy: StrategySpec =
        input.strategy === "buy_and_hold"
          ? { kind: "buy_and_hold" }
          : {
              kind: "drawdown_to_stable",
              maxDrawdownFrac: input.maxDrawdownFrac ?? 0.12,
              reentrySmaDays: input.reentrySmaDays ?? 50,
            };
      const result = runStrategyBacktest(aligned, strategy, {});
      const closes = aligned.map((r) => r.assetClose);
      const p30 = projectForwardFromCloses(closes, 30, { lookback: 60 });
      const p90 = projectForwardFromCloses(closes, 90, { lookback: 60 });
      const p365 = projectForwardFromCloses(closes, 365, { lookback: 60 });
      const maxPoints = 280;
      const series =
        result.series.length > maxPoints ? result.series.slice(-maxPoints) : result.series;
      return {
        symbol: sym,
        benchmark: bench,
        strategy,
        metrics: result.metrics,
        benchmarkMetrics: result.benchmarkMetrics,
        series,
        projections: { days30: p30, days90: p90, days365: p365 },
      };
    },
  });

  const proposeExecution = tool({
    description:
      "Registra in PostgreSQL una proposta di esecuzione (ExecutionLog) in stato DRAFT per RLFF. Usa dopo backtest e consenso logico dell'utente.",
    inputSchema: z.object({
      userPrompt: z.string(),
      aiReasoning: z.string(),
      strategyJSON: z.record(z.string(), z.unknown()),
      marketRoutingMode: marketRoutingSchema.default("SECONDARY_AMM"),
    }),
    execute: async ({ userPrompt, aiReasoning, strategyJSON, marketRoutingMode }) => {
      const idempotencyKey = crypto.randomUUID().replace(/-/g, "").slice(0, 64);
      const pnlStub: Prisma.InputJsonValue = {
        basis: "simulation",
        stage: "proposal",
        unrealizedPnlUsd: null,
      };
      const row = await prisma.executionLog.create({
        data: {
          idempotencyKey,
          userId,
          userPrompt,
          aiReasoning,
          pnlResult: pnlStub,
          marketRoutingMode,
          executionStatus: "DRAFT",
          actionType: "proposeExecution",
          payloadJson: { kind: "proposal_v1", strategy: strategyJSON } as Prisma.InputJsonValue,
          strategyMetrics: strategyJSON as Prisma.InputJsonValue,
        },
      });
      return {
        executionLogId: row.id,
        idempotencyKey: row.idempotencyKey,
        status: row.executionStatus,
      };
    },
  });

  const executeSwap = tool({
    description:
      "Firma mock KMS e sottomette log: DRAFT o PENDING_SIGNATURE → SUBMITTED (per sweeper mock → CONFIRMED/FAILED).",
    inputSchema: z.object({
      executionLogId: z.string(),
      routeType: z.enum(["PRIMARY", "SECONDARY"]),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    execute: async ({ executionLogId, routeType, payload }) => {
      const row = await prisma.executionLog.findFirst({
        where: {
          id: executionLogId,
          userId,
          executionStatus: { in: ["DRAFT", "PENDING_SIGNATURE"] },
        },
      });
      if (!row) {
        return { error: "ExecutionLog non trovato o stato non ammesso", executionLogId };
      }
      const signer = getSigner();
      const chainId = typeof payload?.chainId === "number" ? payload.chainId : 8453;
      const to = (typeof payload?.to === "string" ? payload.to : "0x0000000000000000000000000000000000000001") as `0x${string}`;
      const data = (typeof payload?.data === "string" ? payload.data : "0x") as `0x${string}`;
      const signed = await signer.signTransaction({ chainId, to, data });
      const mergedPayload = {
        ...(row.payloadJson && typeof row.payloadJson === "object" && !Array.isArray(row.payloadJson)
          ? (row.payloadJson as Record<string, unknown>)
          : {}),
        routeType,
        ...(payload ?? {}),
        kmsKeyId: signed.kmsKeyId,
      };
      await prisma.executionLog.update({
        where: { id: row.id },
        data: {
          executionStatus: "SUBMITTED",
          transactionHash: signed.hash,
          actionType: "executeSwap",
          payloadJson: mergedPayload as Prisma.InputJsonValue,
        },
      });
      return {
        executionLogId: row.id,
        status: "SUBMITTED",
        transactionHash: signed.hash,
        routeType,
      };
    },
  });

  return {
    analyzeMarketData,
    runStrategyBacktest: runStrategyBacktestTool,
    proposeExecution,
    executeSwap,
  } as const;
}
