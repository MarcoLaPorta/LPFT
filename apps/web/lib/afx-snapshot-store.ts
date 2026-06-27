import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveRiskCapsApplied } from "./afx-risk-caps";
import type { StrategyAnalysisSnapshot } from "./afx-analysis-types";
import type { SimulatedTrade } from "../services/quant/backtest";

export type PersistSnapshotInput = {
  userId: string;
  source: StrategyAnalysisSnapshot["source"];
  symbol: string;
  benchmark?: string;
  intentClass?: string;
  intentSummary?: string;
  compiledStrategy?: unknown;
  engineSpec?: unknown;
  metrics?: StrategyAnalysisSnapshot["metrics"];
  benchmarkMetrics?: StrategyAnalysisSnapshot["benchmarkMetrics"];
  series?: StrategyAnalysisSnapshot["series"];
  projections?: StrategyAnalysisSnapshot["projections"];
  trades?: SimulatedTrade[];
  marketContext?: StrategyAnalysisSnapshot["marketContext"];
  marketRoutingMode?: string;
  riskCapsApplied?: StrategyAnalysisSnapshot["riskCapsApplied"];
  executionLogId?: string;
};

export async function persistStrategySnapshot(
  input: PersistSnapshotInput & { saved?: boolean; title?: string },
): Promise<string | null> {
  try {
    const row = await prisma.strategySnapshot.create({
      data: {
        userId: input.userId,
        source: input.source,
        symbol: input.symbol,
        benchmark: input.benchmark ?? null,
        intentClass: input.intentClass ?? null,
        intentSummary: input.intentSummary ?? null,
        compiledStrategy: input.compiledStrategy as Prisma.InputJsonValue | undefined,
        engineSpec: input.engineSpec as Prisma.InputJsonValue | undefined,
        metrics: input.metrics as Prisma.InputJsonValue | undefined,
        benchmarkMetrics: input.benchmarkMetrics as Prisma.InputJsonValue | undefined,
        equitySeries: input.series as Prisma.InputJsonValue | undefined,
        projections: input.projections as Prisma.InputJsonValue | undefined,
        trades: input.trades as Prisma.InputJsonValue | undefined,
        marketContext: input.marketContext as Prisma.InputJsonValue | undefined,
        marketRoutingMode: input.marketRoutingMode ?? null,
        riskCapsApplied: input.riskCapsApplied as Prisma.InputJsonValue | undefined,
        makerFeeBps:
          typeof input.riskCapsApplied?.makerFeeBps === "number"
            ? Math.round(input.riskCapsApplied.makerFeeBps)
            : null,
        takerFeeBps:
          typeof input.riskCapsApplied?.takerFeeBps === "number"
            ? Math.round(input.riskCapsApplied.takerFeeBps)
            : null,
        executionLogId: input.executionLogId ?? null,
        savedAt: input.saved ? new Date() : null,
        title: input.title ?? null,
      },
    });
    return row.id;
  } catch {
    return null;
  }
}

export async function markStrategySnapshotSaved(
  id: string,
  userId: string,
  title?: string,
): Promise<boolean> {
  const result = await prisma.strategySnapshot.updateMany({
    where: { id, userId },
    data: {
      savedAt: new Date(),
      ...(title?.trim() ? { title: title.trim().slice(0, 256) } : {}),
    },
  });
  return result.count > 0;
}

export type SavedStrategyListItem = {
  id: string;
  title: string | null;
  symbol: string;
  benchmark: string | null;
  source: string;
  intentSummary: string | null;
  intentClass: string | null;
  metrics: StrategyAnalysisSnapshot["metrics"];
  savedAt: Date;
  createdAt: Date;
};

export async function listSavedStrategySnapshots(userId: string): Promise<SavedStrategyListItem[]> {
  const rows = await prisma.strategySnapshot.findMany({
    where: { userId, savedAt: { not: null } },
    orderBy: { savedAt: "desc" },
    select: {
      id: true,
      title: true,
      symbol: true,
      benchmark: true,
      source: true,
      intentSummary: true,
      intentClass: true,
      metrics: true,
      savedAt: true,
      createdAt: true,
    },
  });
  return rows
    .filter((r): r is typeof r & { savedAt: Date } => r.savedAt != null)
    .map((r) => ({
      id: r.id,
      title: r.title,
      symbol: r.symbol,
      benchmark: r.benchmark,
      source: r.source,
      intentSummary: r.intentSummary,
      intentClass: r.intentClass,
      metrics: r.metrics as StrategyAnalysisSnapshot["metrics"],
      savedAt: r.savedAt,
      createdAt: r.createdAt,
    }));
}

export async function loadStrategySnapshotForUser(id: string, userId: string) {
  return prisma.strategySnapshot.findFirst({
    where: { id, userId },
  });
}

export function snapshotRowToAnalysis(row: {
  id: string;
  source: string;
  symbol: string;
  benchmark: string | null;
  intentClass: string | null;
  intentSummary: string | null;
  compiledStrategy: unknown;
  engineSpec: unknown;
  metrics: unknown;
  benchmarkMetrics: unknown;
  equitySeries: unknown;
  projections: unknown;
  trades: unknown;
  marketContext: unknown;
  marketRoutingMode: string | null;
  riskCapsApplied: unknown;
  createdAt: Date;
  savedAt?: Date | null;
  title?: string | null;
  executionLogId?: string | null;
}): StrategyAnalysisSnapshot & {
  id: string;
  trades: SimulatedTrade[];
  savedAt?: string | null;
  title?: string | null;
  executionLogId?: string | null;
} {
  return {
    id: row.id,
    source: row.source as StrategyAnalysisSnapshot["source"],
    symbol: row.symbol,
    benchmark: row.benchmark ?? undefined,
    intentClass: row.intentClass ?? undefined,
    intentSummary: row.intentSummary ?? undefined,
    compiledStrategy: row.compiledStrategy ?? undefined,
    engineSpec: row.engineSpec as StrategyAnalysisSnapshot["engineSpec"],
    metrics: row.metrics as StrategyAnalysisSnapshot["metrics"],
    benchmarkMetrics: row.benchmarkMetrics as StrategyAnalysisSnapshot["benchmarkMetrics"],
    series: row.equitySeries as StrategyAnalysisSnapshot["series"],
    projections: row.projections as StrategyAnalysisSnapshot["projections"],
    trades: (Array.isArray(row.trades) ? row.trades : []) as SimulatedTrade[],
    marketContext: row.marketContext as StrategyAnalysisSnapshot["marketContext"],
    regimeAnalysis: (() => {
      const mc = row.marketContext as Record<string, unknown> | null | undefined;
      return mc?.regimeAnalysis as StrategyAnalysisSnapshot["regimeAnalysis"];
    })(),
    pitGuardEnabled: (() => {
      const mc = row.marketContext as Record<string, unknown> | null | undefined;
      return mc?.pitGuardEnabled === true;
    })(),
    marketRoutingMode: row.marketRoutingMode ?? undefined,
    riskCapsApplied: resolveRiskCapsApplied(row.riskCapsApplied, row.compiledStrategy),
    updatedAt: row.createdAt.getTime(),
    savedAt: row.savedAt?.toISOString() ?? null,
    title: row.title ?? null,
    executionLogId: row.executionLogId ?? null,
  };
}
