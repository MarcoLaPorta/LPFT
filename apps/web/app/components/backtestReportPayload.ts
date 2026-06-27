import type { AnalysisReportPayload } from "./AnalysisReportButton";
import type { HFTSessionResult } from "../../services/quant/hft-types";
import { buildHftEquitySeries } from "../../services/quant/hft-metrics";

export function hftOutputToPayload(
  source: string,
  o: Record<string, unknown>,
): AnalysisReportPayload | null {
  const symbol = String(o.symbol ?? o.ticker ?? "").toUpperCase();
  if (!symbol) return null;
  const session = o.hftSession as HFTSessionResult | undefined;
  return {
    source,
    symbol,
    benchmark: o.benchmark ? String(o.benchmark) : undefined,
    intentClass: o.intentClass ? String(o.intentClass) : undefined,
    intentSummary: o.intentSummary ? String(o.intentSummary) : undefined,
    compiledStrategy: o.compiledStrategy,
    engineSpec: o.engineSpec,
    series: Array.isArray(o.series)
      ? (o.series as AnalysisReportPayload["series"])
      : buildHftEquitySeries(session?.trades ?? []).map((p) => ({
          date: p.date,
          equity: p.equity,
          benchmark: p.benchmark,
        })),
    trades: session?.trades ?? [],
    marketRoutingMode: o.marketRoutingMode ? String(o.marketRoutingMode) : undefined,
    riskCapsApplied: o.riskCapsApplied,
  };
}

export function backtestOutputToPayload(
  source: string,
  o: Record<string, unknown>,
): AnalysisReportPayload | null {
  const symbol = String(o.symbol ?? o.ticker ?? "").toUpperCase();
  if (!symbol) return null;
  const series = o.series;
  if (!Array.isArray(series) || series.length < 2) return null;
  return {
    source,
    symbol,
    benchmark: o.benchmark ? String(o.benchmark) : undefined,
    intentClass: o.intentClass ? String(o.intentClass) : undefined,
    intentSummary: o.intentSummary ? String(o.intentSummary) : undefined,
    compiledStrategy: o.compiledStrategy,
    engineSpec: o.engineSpec ?? o.strategy,
    metrics: o.metrics as AnalysisReportPayload["metrics"],
    benchmarkMetrics: o.benchmarkMetrics as AnalysisReportPayload["benchmarkMetrics"],
    series: series as AnalysisReportPayload["series"],
    projections: o.projections,
    trades: o.trades as AnalysisReportPayload["trades"],
    marketRoutingMode: o.marketRoutingMode
      ? String(o.marketRoutingMode)
      : o.suggestedRouting
        ? String(o.suggestedRouting)
        : undefined,
    riskCapsApplied: o.riskCapsApplied,
    executionLogId: o.executionLogId ? String(o.executionLogId) : undefined,
  };
}
