import { getToolName, isToolUIPart, type UIMessage } from "ai";
import type {
  BacktestMetricsView,
  BacktestPointView,
  MarketContextView,
  ProjectionsBundle,
  StrategyAnalysisSnapshot,
} from "./afx-analysis-types";
import { computeDerivedBacktestStats } from "./afx-derived-stats";
import { resolveRiskCapsApplied } from "./afx-risk-caps";
import type { ForwardProjection } from "../services/quant/backtest";

function asMetrics(o: unknown): BacktestMetricsView | undefined {
  if (!o || typeof o !== "object") return undefined;
  const x = o as Record<string, unknown>;
  if (
    typeof x.cagr === "number" &&
    typeof x.sharpe === "number" &&
    typeof x.maxDrawdown === "number"
  ) {
    return { cagr: x.cagr, sharpe: x.sharpe, maxDrawdown: x.maxDrawdown };
  }
  return undefined;
}

function asSeries(o: unknown): BacktestPointView[] | undefined {
  if (!Array.isArray(o) || o.length === 0) return undefined;
  const ok = o.every(
    (p) =>
      p &&
      typeof p === "object" &&
      typeof (p as BacktestPointView).date === "string" &&
      typeof (p as BacktestPointView).equity === "number",
  );
  return ok ? (o as BacktestPointView[]) : undefined;
}

function asProjection(o: unknown): ForwardProjection | undefined {
  if (!o || typeof o !== "object") return undefined;
  const x = o as Record<string, unknown>;
  if (
    typeof x.horizonDays === "number" &&
    typeof x.expectedEquityMultiple === "number" &&
    typeof x.p05EquityMultiple === "number" &&
    typeof x.p95EquityMultiple === "number"
  ) {
    return x as ForwardProjection;
  }
  return undefined;
}

function asProjections(o: unknown): ProjectionsBundle | undefined {
  if (!o || typeof o !== "object") return undefined;
  const x = o as Record<string, unknown>;
  const d30 = asProjection(x.days30);
  const d90 = asProjection(x.days90);
  const d365 = asProjection(x.days365);
  if (d30 && d90 && d365) return { days30: d30, days90: d90, days365: d365 };
  return undefined;
}

function snapshotFromOutput(
  source: StrategyAnalysisSnapshot["source"],
  output: Record<string, unknown>,
): StrategyAnalysisSnapshot | null {
  if (source === "analyzeMarketData") {
    const ticker = String(output.ticker ?? "");
    if (!ticker) return null;
    const ctx: MarketContextView = {
      ticker,
      timeframe: String(output.timeframe ?? "1y"),
      barCount: Number(output.barCount ?? 0),
      firstDate: String(output.firstDate ?? ""),
      lastDate: String(output.lastDate ?? ""),
      lastClose: Number(output.lastClose ?? 0),
      meanClose: Number(output.meanClose ?? 0),
      suggestedRouting: output.suggestedRouting
        ? String(output.suggestedRouting)
        : undefined,
      sampleTail: Array.isArray(output.sampleTail)
        ? (output.sampleTail as MarketContextView["sampleTail"])
        : undefined,
    };
    return {
      source,
      symbol: ticker,
      marketContext: ctx,
      marketRoutingMode: ctx.suggestedRouting,
      updatedAt: Date.now(),
    };
  }

  const symbol = String(
    output.symbol ?? output.ticker ?? (output.compiledStrategy as { backtest?: { primaryTicker?: string } })?.backtest?.primaryTicker ?? "",
  ).toUpperCase();
  if (!symbol) return null;

  const series = asSeries(output.series ?? output.backtestSeries);
  const metrics = asMetrics(output.metrics ?? output.backtestMetrics);
  const benchmarkMetrics = asMetrics(output.benchmarkMetrics);
  const projections = asProjections(output.projections);
  const benchmark = output.benchmark ? String(output.benchmark) : undefined;

  return {
    source,
    symbol,
    benchmark,
    metrics,
    benchmarkMetrics,
    series,
    projections,
    derived: series ? computeDerivedBacktestStats(series) : undefined,
    strategy: output.strategy,
    engineSpec: output.engineSpec,
    intentClass: output.intentClass ? String(output.intentClass) : undefined,
    intentSummary: output.intentSummary ? String(output.intentSummary) : undefined,
    marketRoutingMode: output.marketRoutingMode
      ? String(output.marketRoutingMode)
      : output.suggestedRouting
        ? String(output.suggestedRouting)
        : undefined,
    riskCapsApplied: resolveRiskCapsApplied(output.riskCapsApplied, output.compiledStrategy),
    compiledStrategy: output.compiledStrategy,
    trades: Array.isArray(output.trades) ? (output.trades as StrategyAnalysisSnapshot["trades"]) : undefined,
    snapshotId: output.snapshotId ? String(output.snapshotId) : undefined,
    reportUrl: output.reportUrl ? String(output.reportUrl) : undefined,
    updatedAt: Date.now(),
  };
}

const TOOL_SOURCES: StrategyAnalysisSnapshot["source"][] = [
  "proposeExecution",
  "buildQuantitativeStrategy",
  "runStrategyBacktest",
  "analyzeMarketData",
];

function snapshotRichness(s: StrategyAnalysisSnapshot): number {
  let score = 0;
  if (s.series && s.series.length >= 2) score += 1000;
  if (s.metrics) score += 100;
  if (s.benchmarkMetrics) score += 50;
  if (s.projections) score += 80;
  if (s.derived) score += 40;
  if (s.trades?.length) score += 20;
  if (s.marketContext) score += 10;
  if (s.source === "buildQuantitativeStrategy") score += 5;
  if (s.source === "runStrategyBacktest") score += 5;
  return score;
}

/** Indice dell'ultimo messaggio utente (turno corrente). */
export function lastUserMessageIndex(messages: UIMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

function bestSnapshotInMessage(m: UIMessage): {
  best: StrategyAnalysisSnapshot | null;
  score: number;
} {
  let messageBest: StrategyAnalysisSnapshot | null = null;
  let messageScore = -1;

  for (const part of m.parts) {
    if (!isToolUIPart(part) || part.state !== "output-available") continue;
    const name = getToolName(part);
    if (!TOOL_SOURCES.includes(name as StrategyAnalysisSnapshot["source"])) continue;
    const output = part.output;
    if (!output || typeof output !== "object") continue;
    const rec = output as Record<string, unknown>;
    if (name === "buildQuantitativeStrategy" && rec.success === false) continue;
    if (name === "proposeExecution" && rec.rejected === true) continue;
    const snap = snapshotFromOutput(name as StrategyAnalysisSnapshot["source"], rec);
    if (!snap) continue;
    const score = snapshotRichness(snap);
    if (score > messageScore) {
      messageBest = snap;
      messageScore = score;
    }
  }

  return { best: messageBest, score: messageScore };
}

function mergeMarketContext(
  base: StrategyAnalysisSnapshot,
  m: UIMessage,
): StrategyAnalysisSnapshot {
  for (const part of m.parts) {
    if (!isToolUIPart(part) || part.state !== "output-available") continue;
    if (getToolName(part) !== "analyzeMarketData") continue;
    const output = part.output;
    if (!output || typeof output !== "object") continue;
    const mc = snapshotFromOutput("analyzeMarketData", output as Record<string, unknown>);
    if (mc?.marketContext) {
      return {
        ...base,
        marketContext: mc.marketContext,
        marketRoutingMode: base.marketRoutingMode ?? mc.marketContext.suggestedRouting,
      };
    }
  }
  return base;
}

/**
 * Ultima analisi del turno corrente (solo messaggi assistant dopo l'ultimo messaggio utente).
 * Evita di mostrare backtest/metriche di strategie precedenti mentre AFX riscrive una nuova strategia.
 */
export function extractLatestAnalysis(messages: UIMessage[]): StrategyAnalysisSnapshot | null {
  const lastUserIdx = lastUserMessageIndex(messages);
  if (lastUserIdx < 0 && messages.length === 0) return null;

  let fallback: StrategyAnalysisSnapshot | null = null;
  let fallbackScore = -1;

  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;

    const { best: messageBest, score: messageScore } = bestSnapshotInMessage(m);
    if (messageBest && messageScore > fallbackScore) {
      fallback = messageBest;
      fallbackScore = messageScore;
    }

    if (messageBest && messageScore >= 100) {
      return mergeMarketContext(messageBest, m);
    }
  }

  return fallback;
}
