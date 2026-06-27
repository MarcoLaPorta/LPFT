"use client";

import dynamic from "next/dynamic";
import { useMemo, type ReactNode } from "react";
import type { StrategyAnalysisSnapshot } from "../../lib/afx-analysis-types";
import {
  annualizedVolFromSeries,
  fmtPctFrac,
  metricsRows,
} from "../../lib/afx-derived-stats";
import {
  fmtBps,
  fmtOptionalPrice,
  hasDailyMarketBars,
  resolveHftReportContext,
} from "../../lib/afx-hft-report";
import { summarizeTrades } from "../../lib/trade-stats";
import { ProjectionOutlook } from "./ProjectionOutlook";
import { AnalysisReportButton } from "./AnalysisReportButton";

const BacktestWidget = dynamic(() => import("./BacktestWidget").then((m) => m.BacktestWidget), {
  ssr: false,
  loading: () => (
    <div className="flex h-[240px] items-center justify-center text-[11px] text-[var(--text-tertiary)]">
      Grafico…
    </div>
  ),
});

function sourceLabel(s: StrategyAnalysisSnapshot["source"]) {
  const map: Record<StrategyAnalysisSnapshot["source"], string> = {
    buildQuantitativeStrategy: "Quant Engine",
    runStrategyBacktest: "Backtest",
    proposeExecution: "Proposta esecuzione",
    analyzeMarketData: "Dati mercato",
  };
  return map[s];
}

function Section({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`lpft-panel-lite px-3 py-2.5 ${className}`}>
      {title ? <h3 className="lpft-section-title">{title}</h3> : null}
      {children}
    </section>
  );
}

function MetricCell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] text-[var(--text-tertiary)]">{label}</p>
      <p
        className={[
          "font-mono text-[12px] tabular-nums",
          warn ? "text-[var(--danger)]" : "text-[var(--text-primary)]",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  );
}

export function StrategyAnalysisPanel({ snapshot }: { snapshot: StrategyAnalysisSnapshot | null }) {
  const hasBacktest = (snapshot?.series?.length ?? 0) >= 2;
  const bench = snapshot?.benchmark ?? "^GSPC";

  const tradeSummary = useMemo(
    () => (snapshot?.trades?.length ? summarizeTrades(snapshot.trades) : null),
    [snapshot?.trades],
  );
  const hftCtx = useMemo(
    () => (snapshot ? resolveHftReportContext(snapshot) : null),
    [snapshot],
  );

  if (!snapshot) {
    return (
      <div className="lpft-card lpft-card--lite flex h-full min-h-0 flex-col p-5">
        <p className="text-[13px] text-[var(--text-secondary)]">Report strategia</p>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-tertiary)]">
          Dopo un backtest compare qui il grafico e le metriche principali.
        </p>
      </div>
    );
  }

  const vol = snapshot.series ? annualizedVolFromSeries(snapshot.series) : 0;
  const baseEquity = snapshot.derived?.finalEquity ?? 1;
  const stratMetrics = metricsRows("Strat.", snapshot.metrics);
  const benchMetrics = metricsRows("Bench", snapshot.benchmarkMetrics);

  return (
    <div className="lpft-card lpft-card--lite flex h-full min-h-0 w-full flex-col overflow-hidden">
      <header className="lpft-analysis-header shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[var(--accent)]">{sourceLabel(snapshot.source)}</p>
            <p className="mt-0.5 font-mono text-[15px] font-medium text-[var(--text-primary)]">
              {snapshot.symbol}
              {snapshot.benchmark ? (
                <span className="font-normal text-[var(--text-tertiary)]"> vs {bench}</span>
              ) : null}
            </p>
          </div>
          {hasBacktest ? (
            <AnalysisReportButton
              cacheKey={`panel-${snapshot.symbol}-${snapshot.updatedAt}`}
              payload={{
                source: snapshot.source,
                symbol: snapshot.symbol,
                benchmark: snapshot.benchmark,
                intentClass: snapshot.intentClass,
                intentSummary: snapshot.intentSummary,
                compiledStrategy: snapshot.compiledStrategy,
                engineSpec: snapshot.engineSpec,
                metrics: snapshot.metrics,
                benchmarkMetrics: snapshot.benchmarkMetrics,
                series: snapshot.series,
                projections: snapshot.projections,
                trades: snapshot.trades,
                marketRoutingMode: snapshot.marketRoutingMode,
                riskCapsApplied: snapshot.riskCapsApplied,
              }}
              snapshotId={snapshot.snapshotId}
              reportUrl={snapshot.reportUrl}
            />
          ) : null}
        </div>
        {snapshot.derived ? (
          <p className="mt-1.5 font-mono text-[10px] text-[var(--text-tertiary)]">
            {snapshot.derived.firstDate} → {snapshot.derived.lastDate} · {snapshot.derived.barCount} barre
          </p>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3 scrollbar-thin">
          {hasBacktest && snapshot.series ? (
            <Section className="overflow-hidden p-2">
              <BacktestWidget
                key={`${snapshot.symbol}-${snapshot.updatedAt ?? 0}-${snapshot.source}`}
                symbol={snapshot.symbol}
                benchmarkSymbol={bench}
                series={snapshot.series}
                metrics={snapshot.metrics}
                benchmarkMetrics={snapshot.benchmarkMetrics}
                height={220}
                showLegend
                compactMetrics
              />
            </Section>
          ) : null}
          {(snapshot.metrics || snapshot.benchmarkMetrics || snapshot.derived) && (
            <Section title="Metriche">
              <div className="lpft-metric-grid lpft-metric-grid--wide">
                {stratMetrics.map((r) => (
                  <MetricCell key={r.label} label={r.label} value={r.value} />
                ))}
                {benchMetrics.map((r) => (
                  <MetricCell key={r.label} label={r.label} value={r.value} />
                ))}
                {snapshot.derived ? (
                  <>
                    <MetricCell label="Rend. totale" value={fmtPctFrac(snapshot.derived.totalReturn)} />
                    <MetricCell
                      label="Alpha"
                      value={fmtPctFrac(snapshot.derived.alphaVsBenchmark)}
                      warn={snapshot.derived.alphaVsBenchmark < 0}
                    />
                    <MetricCell label="Vol ann." value={fmtPctFrac(vol)} />
                  </>
                ) : null}
              </div>
            </Section>
          )}

          {tradeSummary ? (
            <Section title="Transazioni">
              <div className="lpft-metric-grid">
                <MetricCell label="N. trade" value={String(tradeSummary.count)} />
                <MetricCell label="Win rate" value={fmtPctFrac(tradeSummary.winRate, 1)} />
                <MetricCell label="Profit factor" value={tradeSummary.profitFactor.toFixed(2)} />
                <MetricCell label="Hold medio" value={`${tradeSummary.avgHoldDays.toFixed(0)}g`} />
              </div>
            </Section>
          ) : null}

          {hftCtx?.hftMetrics ? (
            <Section title="HFT">
              <div className="lpft-metric-grid">
                <MetricCell label="PnL sessione" value={fmtBps(hftCtx.hftMetrics.sessionPnLBps)} />
                <MetricCell label="Win rate" value={fmtPctFrac(hftCtx.hftMetrics.winRate, 1)} />
                <MetricCell label="N. scalp" value={String(hftCtx.hftMetrics.tradeCount)} />
                <MetricCell
                  label="Profit factor"
                  value={
                    hftCtx.hftMetrics.profitFactor != null
                      ? hftCtx.hftMetrics.profitFactor.toFixed(2)
                      : "—"
                  }
                />
              </div>
            </Section>
          ) : null}

          {hasDailyMarketBars(snapshot.marketContext) ? (
            <Section title="Mercato">
              <div className="lpft-metric-grid">
                <MetricCell label="Close" value={fmtOptionalPrice(snapshot.marketContext?.lastClose)} />
                <MetricCell label="Media" value={fmtOptionalPrice(snapshot.marketContext?.meanClose)} />
              </div>
            </Section>
          ) : null}

          {snapshot.projections ? (
            <Section title="Proiezioni">
              <ProjectionOutlook projections={snapshot.projections} baseEquity={baseEquity} compact />
            </Section>
          ) : null}

          {snapshot.riskCapsApplied ? (
            <p className="px-1 text-[11px] text-[var(--text-tertiary)]">
              Risk: DD max {(snapshot.riskCapsApplied.maxDrawdownLimit * 100).toFixed(0)}% · SL{" "}
              {(snapshot.riskCapsApplied.stopLossPercentage * 100).toFixed(0)}%
            </p>
          ) : null}
      </div>
    </div>
  );
}
