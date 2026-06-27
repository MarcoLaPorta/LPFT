"use client";

import dynamic from "next/dynamic";
import { computeDerivedBacktestStats, fmtPctFrac } from "../../lib/afx-derived-stats";
import { sourceLabel } from "../../lib/format-strategy-summary";
import type { AnalysisReportPayload } from "./AnalysisReportButton";
import { SaveStrategyActions } from "./SaveStrategyActions";
import type { BacktestPoint } from "./BacktestWidget";

const BacktestWidget = dynamic(() => import("./BacktestWidget").then((m) => m.BacktestWidget), {
  ssr: false,
  loading: () => (
    <div className="flex h-[260px] items-center justify-center text-[11px] text-[var(--text-tertiary)]">
      Grafico…
    </div>
  ),
});

type Metrics = { cagr: number; sharpe: number; maxDrawdown: number };

type Props = {
  source: string;
  symbol: string;
  benchmark?: string;
  intentSummary?: string;
  intentClass?: string;
  series: BacktestPoint[];
  metrics?: Metrics;
  benchmarkMetrics?: Metrics;
  tradeCount?: number;
  snapshotId?: string | null;
  reportUrl?: string | null;
  payload: AnalysisReportPayload | null;
  cacheKey: string;
};

function MetricPill({
  label,
  value,
  hint,
  warn,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "lpft-inline-metric",
        accent ? "border-[var(--accent-muted)] bg-[var(--accent-muted)]" : "",
      ].join(" ")}
      title={hint}
    >
      <span className="lpft-inline-metric-label">{label}</span>
      <span className={["lpft-inline-metric-value", warn ? "text-[var(--danger)]" : ""].join(" ")}>
        {value}
      </span>
      {hint ? <span className="mt-0.5 block text-[9px] leading-tight text-[var(--text-tertiary)]">{hint}</span> : null}
    </div>
  );
}

export function AnalysisInlineWidget({
  source,
  symbol,
  benchmark = "^GSPC",
  intentSummary,
  intentClass,
  series,
  metrics,
  benchmarkMetrics,
  tradeCount,
  snapshotId,
  reportUrl,
  payload,
  cacheKey,
}: Props) {
  const derived = series.length >= 2 ? computeDerivedBacktestStats(series) : undefined;

  return (
    <div className="lpft-inline-analysis">
      <div className="lpft-inline-analysis-head">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
            {sourceLabel(source)}
          </p>
          <p className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{symbol}</p>
          {intentClass ? (
            <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{intentClass}</p>
          ) : null}
          {intentSummary ? (
            <p className="mt-1.5 text-[12px] leading-snug text-[var(--text-secondary)]">{intentSummary}</p>
          ) : null}
        </div>
        {tradeCount != null && tradeCount > 0 ? (
          <span className="lpft-report-chip shrink-0">{tradeCount} trade</span>
        ) : null}
      </div>

      {metrics ? (
        <div className="lpft-inline-metric-row">
          {derived ? (
            <MetricPill
              label="Rend. periodo"
              value={fmtPctFrac(derived.totalReturn)}
              hint="Rendimento sull'intero periodo del backtest"
              accent={derived.totalReturn >= 0}
              warn={derived.totalReturn < 0}
            />
          ) : null}
          <MetricPill
            label="CAGR"
            value={fmtPctFrac(metrics.cagr)}
            hint="Rendimento annuo medio (annualizzato)"
          />
          <MetricPill
            label="Sharpe"
            value={metrics.sharpe.toFixed(2)}
            hint="Rendimento / rischio (annualizzato)"
          />
          <MetricPill
            label="Max DD"
            value={fmtPctFrac(metrics.maxDrawdown, 1)}
            hint="Peggior calo dal picco"
            warn
          />
        </div>
      ) : null}

      {series.length >= 2 ? (
        <div className="lpft-inline-chart">
          <BacktestWidget
            symbol={symbol}
            benchmarkSymbol={benchmark}
            series={series}
            metrics={metrics}
            height={260}
            showBenchmark={false}
            compactMetrics
          />
        </div>
      ) : null}

      <SaveStrategyActions
        snapshotId={snapshotId}
        reportUrl={reportUrl}
        payload={payload}
        defaultTitle={intentSummary ?? symbol}
        cacheKey={cacheKey}
      />
    </div>
  );
}
