import type { HFTSessionMetricsView, MarketContextView, StrategyAnalysisSnapshot } from "./afx-analysis-types";
import type { HFTScalpTrade, HFTSessionResult } from "../services/quant/hft-types";

export type HftReportContext = {
  hftMetrics?: HFTSessionMetricsView;
  hftTrades: HFTScalpTrade[];
  replayStats?: {
    sessionsRun?: number;
    sessionsPlanned?: number;
    totalEvents?: number;
  };
};

export function resolveHftReportContext(
  snapshot: Pick<StrategyAnalysisSnapshot, "marketContext" | "intentClass">,
): HftReportContext | null {
  const mc = snapshot.marketContext;
  if (!mc?.hftMetrics && snapshot.intentClass !== "HIGH_FREQUENCY_SCALPING") return null;
  const hftMetrics = mc?.hftMetrics;
  const session = mc?.hftSession as HFTSessionResult | undefined;
  const hftTrades = session?.trades ?? [];
  if (!hftMetrics && hftTrades.length === 0) return null;
  const replayStats = mc?.replayStats as HftReportContext["replayStats"] | undefined;
  return { hftMetrics, hftTrades, replayStats };
}

export function hasDailyMarketBars(mc?: MarketContextView): boolean {
  if (!mc) return false;
  return mc.lastClose != null || mc.meanClose != null || mc.barCount != null;
}

export function fmtOptionalPrice(n?: number, digits = 2): string {
  return n != null && Number.isFinite(n) ? n.toFixed(digits) : "—";
}

export function fmtBps(n?: number, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)} bps`;
}
