"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  fmtBps,
  fmtOptionalPrice,
  hasDailyMarketBars,
  resolveHftReportContext,
} from "../../lib/afx-hft-report";
import { resolveRiskCapsApplied } from "../../lib/afx-risk-caps";
import {
  annualizedVolFromSeries,
  computeDerivedBacktestStats,
  fmtPctFrac,
  metricsRows,
} from "../../lib/afx-derived-stats";
import {
  routingLabel,
  sourceLabel,
  summarizeCompiledStrategy,
} from "../../lib/format-strategy-summary";
import {
  advancedMetricLabel,
  computeAdvancedMetrics,
  drawdownSeries,
  formatAdvancedMetric,
  monthlyReturns,
  relativeStrengthSeries,
  rollingVolatilitySeries,
} from "../../lib/series-analytics";
import {
  maxDrawdownFromSeries,
  summarizeTrades,
  yearlyReturns,
} from "../../lib/trade-stats";
import type { SimulatedTrade } from "../../services/quant/backtest";
import type { StrategyAnalysisSnapshot } from "../../lib/afx-analysis-types";
import { BacktestWidget, type BacktestPoint } from "./BacktestWidget";
import { HFTScalpTradeBars } from "./HFTScalpTradeBars";
import { ProjectionOutlook } from "./ProjectionOutlook";
import { ReportExecutionConfirm } from "./ReportExecutionConfirm";
import { SaveStrategyActions } from "./SaveStrategyActions";
import type { AnalysisReportPayload } from "./AnalysisReportButton";
import { MonthlyReturnsBars } from "./analysis/MonthlyReturnsBars";
import { TradeAnalysisBlock } from "./analysis/TradeAnalysisBlock";

const SimpleLineChart = dynamic(
  () => import("./analysis/SimpleLineChart").then((m) => m.SimpleLineChart),
  { ssr: false, loading: () => <ChartSkeleton height={220} /> },
);

export type StrategyReportData = StrategyAnalysisSnapshot & {
  id: string;
  trades: SimulatedTrade[];
  savedAt?: string | null;
  title?: string | null;
  executionLogId?: string | null;
};

function reportToPayload(data: StrategyReportData): AnalysisReportPayload | null {
  if ((data.series?.length ?? 0) < 2) return null;
  return {
    source: data.source,
    symbol: data.symbol,
    benchmark: data.benchmark,
    intentClass: data.intentClass,
    intentSummary: data.intentSummary,
    compiledStrategy: data.compiledStrategy,
    engineSpec: data.engineSpec,
    metrics: data.metrics,
    benchmarkMetrics: data.benchmarkMetrics,
    series: data.series,
    projections: data.projections,
    trades: data.trades,
    marketRoutingMode: data.marketRoutingMode,
    riskCapsApplied: data.riskCapsApplied,
  };
}

const NAV = [
  { id: "panoramica", label: "Panoramica" },
  { id: "grafici", label: "Grafici" },
  { id: "regimi", label: "Regimi stress" },
  { id: "rischio", label: "Rischio" },
  { id: "trade", label: "Trade" },
  { id: "serie", label: "Serie" },
  { id: "strategia", label: "Strategia" },
] as const;

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.03)] text-[11px] text-[var(--text-tertiary)]"
      style={{ height }}
    >
      Caricamento…
    </div>
  );
}

function useActiveSection(sectionIds: readonly string[]) {
  const [active, setActive] = useState(sectionIds[0] ?? "");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.15, 0.4] },
    );

    for (const id of sectionIds) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sectionIds]);

  return active;
}

function computeVerdict(
  metrics?: { sharpe?: number; cagr?: number },
  alpha?: number,
): { tone: "pos" | "neu" | "neg"; label: string } {
  const sharpe = metrics?.sharpe ?? 0;
  const cagr = metrics?.cagr ?? 0;
  const a = alpha ?? 0;
  if (sharpe >= 0.5 && a > 0 && cagr > 0) return { tone: "pos", label: "Profilo solido" };
  if (sharpe < -0.2 || a < -0.05 || cagr < -0.05) return { tone: "neg", label: "Profilo debole" };
  return { tone: "neu", label: "Profilo misto" };
}

function Section({
  id,
  title,
  desc,
  children,
}: {
  id: string;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="lpft-report-section">
      <h2 className="lpft-report-section-title">{title}</h2>
      {desc ? <p className="lpft-report-section-desc">{desc}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function MetricCell({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-lg border px-2.5 py-2",
        accent
          ? "border-[var(--accent-muted)] bg-[var(--accent-muted)]"
          : warn
            ? "border-[rgba(255,69,58,0.25)] bg-[rgba(255,69,58,0.06)]"
            : "border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)]",
      ].join(" ")}
    >
      <p className="text-[9px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <p className="font-mono text-[12px] tabular-nums text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

function exportTradesCsv(trades: SimulatedTrade[], symbol: string) {
  const header = "trade,entry_date,exit_date,entry_price,exit_price,pnl_pct,pnl_equity,reason_entry,reason_exit";
  const rows = trades.map((t) =>
    [
      t.tradeIndex,
      t.entryDate,
      t.exitDate,
      t.entryPrice,
      t.exitPrice,
      t.pnlFrac,
      t.pnlEquity,
      t.reasonEntry,
      t.reasonExit,
    ].join(","),
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${symbol}-trades.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function StrategyReportView({ data }: { data: StrategyReportData }) {
  const [copied, setCopied] = useState(false);
  const navIds = useMemo(() => NAV.map((n) => n.id), []);
  const activeSection = useActiveSection(navIds);

  const riskCaps = useMemo(
    () => resolveRiskCapsApplied(data.riskCapsApplied, data.compiledStrategy),
    [data.riskCapsApplied, data.compiledStrategy],
  );
  const derived = useMemo(
    () => (data.series?.length ? computeDerivedBacktestStats(data.series) : data.derived),
    [data.series, data.derived],
  );
  const vol = data.series ? annualizedVolFromSeries(data.series) : 0;
  const bench = data.benchmark ?? "^GSPC";
  const hftCtx = useMemo(() => resolveHftReportContext(data), [data]);
  const tradeSummary = useMemo(
    () => (data.trades.length ? summarizeTrades(data.trades) : null),
    [data.trades],
  );
  const computedMaxDd = data.series ? maxDrawdownFromSeries(data.series) : null;
  const byYear = data.series ? yearlyReturns(data.series) : [];
  const byMonth = data.series ? monthlyReturns(data.series) : [];
  const ddSeries = data.series ? drawdownSeries(data.series) : [];
  const rsSeries = data.series ? relativeStrengthSeries(data.series) : [];
  const rollVol = data.series ? rollingVolatilitySeries(data.series, 21) : { strat: [], bench: [] };
  const advanced = useMemo(
    () =>
      data.series
        ? computeAdvancedMetrics(data.series, data.metrics?.cagr, computedMaxDd ?? data.metrics?.maxDrawdown)
        : null,
    [data.series, data.metrics, computedMaxDd],
  );
  const strategyBullets = useMemo(
    () => summarizeCompiledStrategy(data.compiledStrategy),
    [data.compiledStrategy],
  );
  const verdict = computeVerdict(data.metrics, derived?.alphaVsBenchmark);
  const seriesTail = data.series?.slice(-30) ?? [];
  const reportDate = data.updatedAt
    ? new Date(data.updatedAt).toLocaleString("it-IT", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const reportPayload = useMemo(() => reportToPayload(data), [data]);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const hasChart = (data.series?.length ?? 0) >= 2;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 sm:px-8">
      <header className="lpft-report-hero">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`lpft-report-verdict lpft-report-verdict--${verdict.tone}`}>{verdict.label}</span>
              <span className="lpft-report-chip">{sourceLabel(data.source)}</span>
              {data.intentClass ? <span className="lpft-report-chip">{data.intentClass}</span> : null}
              {data.marketRoutingMode ? (
                <span className="lpft-report-chip">{routingLabel(data.marketRoutingMode)}</span>
              ) : null}
              {data.pitGuardEnabled ? <span className="lpft-report-chip">PiT guard</span> : null}
            </div>
            <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">
              {data.symbol}
              <span className="text-lg font-normal text-[var(--text-tertiary)] sm:text-xl"> vs {bench}</span>
            </h1>
            {data.intentSummary ? (
              <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-[var(--text-secondary)]">
                {data.intentSummary}
              </p>
            ) : null}
            {derived ? (
              <p className="mt-2 font-mono text-[11px] text-[var(--text-tertiary)]">
                {derived.firstDate} → {derived.lastDate} · {derived.barCount} barre
                {reportDate ? ` · generato ${reportDate}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <SaveStrategyActions
              snapshotId={data.id}
              reportUrl={`/analysis/${data.id}`}
              payload={reportPayload}
              defaultTitle={data.title ?? data.intentSummary ?? data.symbol}
              cacheKey={`report-${data.id}`}
              initialSaved={Boolean(data.savedAt)}
              hideReportLink
            />
            <Link href="/strategies" className="lpft-btn-secondary">
              Libreria
            </Link>
            <button type="button" onClick={() => void copyLink()} className="lpft-btn-secondary">
              {copied ? "Link copiato" : "Copia link"}
            </button>
            {data.trades.length > 0 ? (
              <button
                type="button"
                onClick={() => exportTradesCsv(data.trades, data.symbol)}
                className="lpft-btn-secondary"
              >
                Esporta CSV
              </button>
            ) : null}
            <Link href="/" className="lpft-btn-secondary">
              ← Chat
            </Link>
          </div>
        </div>

        {data.executionLogId ? (
          <ReportExecutionConfirm
            executionLogId={data.executionLogId}
            symbol={data.symbol}
            benchmark={data.benchmark}
            marketRoutingMode={data.marketRoutingMode}
            metrics={data.metrics}
            series={data.series as BacktestPoint[] | undefined}
            snapshotId={data.id}
            reportUrl={`/analysis/${data.id}`}
          />
        ) : null}

        <div className="lpft-report-kpi-row">
          {hftCtx?.hftMetrics ? (
            <>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">PnL sessione</p>
                <p
                  className={[
                    "lpft-report-kpi-value",
                    hftCtx.hftMetrics.sessionPnLBps >= 0
                      ? "lpft-report-kpi-value--pos"
                      : "lpft-report-kpi-value--neg",
                  ].join(" ")}
                >
                  {fmtBps(hftCtx.hftMetrics.sessionPnLBps)}
                </p>
              </div>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">Win rate</p>
                <p className="lpft-report-kpi-value">{fmtPctFrac(hftCtx.hftMetrics.winRate, 1)}</p>
              </div>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">Scalp</p>
                <p className="lpft-report-kpi-value">{hftCtx.hftMetrics.tradeCount}</p>
              </div>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">Profit factor</p>
                <p className="lpft-report-kpi-value">
                  {hftCtx.hftMetrics.profitFactor != null
                    ? hftCtx.hftMetrics.profitFactor.toFixed(2)
                    : "—"}
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">CAGR strategia</p>
                <p
                  className={[
                    "lpft-report-kpi-value",
                    (data.metrics?.cagr ?? 0) >= 0 ? "lpft-report-kpi-value--pos" : "lpft-report-kpi-value--neg",
                  ].join(" ")}
                >
                  {fmtPctFrac(data.metrics?.cagr ?? 0)}
                </p>
              </div>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">Sharpe</p>
                <p className="lpft-report-kpi-value">{(data.metrics?.sharpe ?? 0).toFixed(2)}</p>
              </div>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">Max drawdown</p>
                <p className="lpft-report-kpi-value lpft-report-kpi-value--neg">
                  {fmtPctFrac(computedMaxDd ?? data.metrics?.maxDrawdown ?? 0, 1)}
                </p>
              </div>
              <div className="lpft-report-kpi">
                <p className="lpft-report-kpi-label">Alpha vs bench</p>
                <p
                  className={[
                    "lpft-report-kpi-value",
                    (derived?.alphaVsBenchmark ?? 0) >= 0
                      ? "lpft-report-kpi-value--pos"
                      : "lpft-report-kpi-value--neg",
                  ].join(" ")}
                >
                  {fmtPctFrac(derived?.alphaVsBenchmark ?? 0)}
                </p>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="lpft-report-nav">
        <div className="lpft-report-nav-inner" role="tablist" aria-label="Sezioni report">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={activeSection === item.id}
              onClick={() => scrollTo(item.id)}
              className={[
                "lpft-report-nav-link",
                activeSection === item.id ? "lpft-report-nav-link--active" : "",
              ].join(" ")}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {hasChart ? (
        <div className="lpft-report-chart-card">
          <p className="mb-2 text-[11px] font-medium text-[var(--text-tertiary)]">
            Equity normalizzata · strategia vs benchmark
          </p>
          <BacktestWidget
            symbol={data.symbol}
            benchmarkSymbol={bench}
            series={data.series!}
            metrics={data.metrics}
            benchmarkMetrics={data.benchmarkMetrics}
            height={340}
            showLegend
            compactMetrics
          />
        </div>
      ) : null}

      <div className="mt-6 space-y-5">
        <Section id="panoramica" title="Panoramica" desc="Metriche chiave e analisi dei trade simulati.">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {metricsRows("Strategia", data.metrics).map((r) => (
              <MetricCell key={r.label} label={r.label} value={r.value} accent />
            ))}
            {metricsRows("Benchmark", data.benchmarkMetrics).map((r) => (
              <MetricCell key={r.label} label={r.label} value={r.value} />
            ))}
            {derived ? (
              <>
                <MetricCell label="Rend. totale" value={fmtPctFrac(derived.totalReturn)} accent />
                <MetricCell
                  label="Alpha"
                  value={fmtPctFrac(derived.alphaVsBenchmark)}
                  warn={derived.alphaVsBenchmark < 0}
                />
                <MetricCell label="Vol ann." value={fmtPctFrac(vol)} />
                <MetricCell label="Max DD calc." value={fmtPctFrac(computedMaxDd ?? 0, 1)} warn />
              </>
            ) : null}
          </div>

          {advanced ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(Object.keys(advanced) as (keyof typeof advanced)[]).map((k) => (
                <MetricCell
                  key={k}
                  label={advancedMetricLabel(k)}
                  value={formatAdvancedMetric(k, advanced[k])}
                />
              ))}
            </div>
          ) : null}

          <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
              Analisi trade
            </h3>
            <div className="mt-3">
              {hftCtx && hftCtx.hftTrades.length > 0 ? (
                <>
                  {hftCtx.hftMetrics ? (
                    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <MetricCell label="PnL sessione" value={fmtBps(hftCtx.hftMetrics.sessionPnLBps)} accent />
                      <MetricCell label="Win rate" value={fmtPctFrac(hftCtx.hftMetrics.winRate, 1)} />
                      <MetricCell label="N. scalp" value={String(hftCtx.hftMetrics.tradeCount)} />
                      <MetricCell
                        label="Latenza media"
                        value={
                          Number.isFinite(hftCtx.hftMetrics.avgLatencyMs)
                            ? `${hftCtx.hftMetrics.avgLatencyMs.toFixed(1)} ms`
                            : "—"
                        }
                      />
                    </div>
                  ) : null}
                  <HFTScalpTradeBars trades={hftCtx.hftTrades} />
                </>
              ) : (
                <TradeAnalysisBlock trades={data.trades} summary={tradeSummary} />
              )}
            </div>
          </div>

          {data.projections ? (
            <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
              <ProjectionOutlook projections={data.projections} baseEquity={derived?.finalEquity ?? 1} />
            </div>
          ) : null}
        </Section>

        {hasChart ? (
          <Section
            id="grafici"
            title="Grafici"
            desc="Drawdown, forza relativa, volatilità rolling e rendimenti mensili."
          >
            <div className="space-y-6">
              <div>
                <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">Drawdown (underwater)</p>
                <SimpleLineChart
                  data={ddSeries}
                  height={220}
                  color="rgba(255, 69, 58, 0.85)"
                  fill="rgba(255, 69, 58, 0.1)"
                />
              </div>
              <div>
                <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">Forza relativa (equity / benchmark)</p>
                <SimpleLineChart data={rsSeries} height={220} />
              </div>
              {rollVol.strat.length > 2 ? (
                <div>
                  <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">Volatilità rolling 21g (ann.)</p>
                  <SimpleLineChart data={rollVol.strat} height={200} color="rgba(124, 58, 237, 0.85)" />
                </div>
              ) : null}
              {byMonth.length > 0 ? (
                <div>
                  <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">Rendimenti mensili</p>
                  <MonthlyReturnsBars rows={byMonth} />
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {data.regimeAnalysis?.windows?.length ? (
          <Section
            id="regimi"
            title="Regimi di stress"
            desc="Metriche isolate su finestre storiche (Covid 2020, bear 2022, volatilità 2023)."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[rgba(255,255,255,0.08)] text-[var(--text-tertiary)]">
                    <th className="py-2 pr-3 font-medium">Regime</th>
                    <th className="py-2 pr-3 font-medium">Barre</th>
                    <th className="py-2 pr-3 font-medium">CAGR strat.</th>
                    <th className="py-2 pr-3 font-medium">Max DD</th>
                    <th className="py-2 pr-3 font-medium">Sharpe</th>
                    <th className="py-2 font-medium">Rend. periodo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.regimeAnalysis.windows
                    .filter((w) => w.overlap)
                    .map((w) => (
                      <tr key={w.id} className="border-b border-[rgba(255,255,255,0.04)]">
                        <td className="py-2 pr-3 text-[var(--text-secondary)]">{w.label}</td>
                        <td className="py-2 pr-3 font-mono">{w.barCount}</td>
                        <td className="py-2 pr-3 font-mono">{fmtPctFrac(w.strategy.cagr)}</td>
                        <td className="py-2 pr-3 font-mono text-red-300/90">
                          {fmtPctFrac(w.strategy.maxDrawdown, 1)}
                        </td>
                        <td className="py-2 pr-3 font-mono">{w.strategy.sharpe.toFixed(2)}</td>
                        <td className="py-2 font-mono">{fmtPctFrac(w.relativeReturn)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {data.regimeAnalysis.stressOnly ? (
              <p className="mt-3 text-[11px] text-[var(--text-tertiary)]">
                Aggregato stress: CAGR {fmtPctFrac(data.regimeAnalysis.stressOnly.cagr)}, max DD{" "}
                {fmtPctFrac(data.regimeAnalysis.stressOnly.maxDrawdown, 1)}
              </p>
            ) : null}
          </Section>
        ) : null}

        <Section id="rischio" title="Rischio e mercato">
          {riskCaps ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <MetricCell
                label="Max drawdown cap"
                value={`${(riskCaps.maxDrawdownLimit * 100).toFixed(0)}%`}
                warn
              />
              <MetricCell label="Stop loss" value={`${(riskCaps.stopLossPercentage * 100).toFixed(0)}%`} />
              <MetricCell label="Trailing stop" value={riskCaps.trailingStop ? "Attivo" : "Off"} />
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text-tertiary)]">Nessun risk cap esplicito nel payload.</p>
          )}
          {hasDailyMarketBars(data.marketContext) ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              <MetricCell label="Ultimo close" value={fmtOptionalPrice(data.marketContext?.lastClose)} accent />
              <MetricCell label="Media" value={fmtOptionalPrice(data.marketContext?.meanClose)} />
              <MetricCell
                label="Barre"
                value={data.marketContext?.barCount != null ? String(data.marketContext.barCount) : "—"}
              />
            </div>
          ) : null}
          {hftCtx?.hftMetrics ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCell label="Tick processati" value={String(hftCtx.hftMetrics.ticksProcessed)} />
              <MetricCell label="Book updates" value={String(hftCtx.hftMetrics.bookUpdates)} />
              {hftCtx.replayStats?.sessionsRun != null ? (
                <MetricCell
                  label="Giorni replay"
                  value={`${hftCtx.replayStats.sessionsRun}/${hftCtx.replayStats.sessionsPlanned ?? "?"}`}
                />
              ) : null}
              {hftCtx.replayStats?.totalEvents != null ? (
                <MetricCell label="Eventi tick/quote" value={hftCtx.replayStats.totalEvents.toLocaleString("it-IT")} />
              ) : null}
            </div>
          ) : null}
          {byYear.length > 0 ? (
            <div className="lpft-report-table-wrap mt-4 max-h-56">
              <table className="w-full font-mono text-[12px]">
                <thead>
                  <tr className="text-[var(--text-tertiary)]">
                    <th className="px-3 py-2 text-left font-normal">Anno</th>
                    <th className="px-3 py-2 text-right font-normal">Rendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {byYear.map((y) => (
                    <tr key={y.year} className="border-t border-[var(--border-subtle)]">
                      <td className="px-3 py-1.5">{y.year}</td>
                      <td
                        className={`px-3 py-1.5 text-right ${y.ret >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
                      >
                        {fmtPctFrac(y.ret)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>

        {seriesTail.length > 0 ? (
          <Section id="serie" title="Serie equity (ultime 30 barre)">
            <div className="lpft-report-table-wrap max-h-80">
              <table className="w-full font-mono text-[11px]">
                <thead>
                  <tr className="text-[var(--text-tertiary)]">
                    <th className="px-3 py-2 text-left font-normal">Data</th>
                    <th className="px-3 py-2 text-right font-normal">Equity</th>
                    <th className="px-3 py-2 text-right font-normal">Benchmark</th>
                    <th className="px-3 py-2 text-right font-normal">Spread</th>
                  </tr>
                </thead>
                <tbody>
                  {seriesTail.map((p) => (
                    <tr key={p.date} className="border-t border-[var(--border-subtle)]">
                      <td className="px-3 py-1.5">{p.date}</td>
                      <td className="px-3 py-1.5 text-right">{p.equity.toFixed(4)}</td>
                      <td className="px-3 py-1.5 text-right">{p.benchmark.toFixed(4)}</td>
                      <td className="px-3 py-1.5 text-right">{(p.equity - p.benchmark).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        ) : null}

        <Section id="strategia" title="Strategia e motore">
          {strategyBullets.length > 0 ? (
            <ul className="lpft-report-bullets">
              {strategyBullets.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-[var(--text-tertiary)]">Nessun riepilogo strutturato disponibile.</p>
          )}

          {data.engineSpec ? (
            <details className="lpft-report-details mt-4">
              <summary className="mb-2">Mostra specifica motore (JSON)</summary>
              <pre className="lpft-code-block max-h-48 overflow-auto p-3 text-[11px]">
                {JSON.stringify(data.engineSpec, null, 2)}
              </pre>
            </details>
          ) : null}

          {data.compiledStrategy ? (
            <details className="lpft-report-details mt-3">
              <summary className="mb-2">Mostra payload strategia completo (JSON)</summary>
              <pre className="lpft-code-block max-h-[32rem] overflow-auto p-4 text-[11px]">
                {JSON.stringify(data.compiledStrategy, null, 2)}
              </pre>
            </details>
          ) : (
            <p className="mt-3 text-[12px] text-[var(--text-tertiary)]">Nessuna strategia compilata salvata.</p>
          )}

          {data.marketContext ? (
            <details className="lpft-report-details mt-3">
              <summary className="mb-2">Mostra marketContext (JSON)</summary>
              <pre className="lpft-code-block max-h-[32rem] overflow-auto p-4 text-[11px]">
                {JSON.stringify(data.marketContext, null, 2)}
              </pre>
            </details>
          ) : null}

          {hftCtx ? (
            <details className="lpft-report-details mt-3">
              <summary className="mb-2">Mostra sessione HFT completa (JSON)</summary>
              <pre className="lpft-code-block max-h-[32rem] overflow-auto p-4 text-[11px]">
                {JSON.stringify(
                  {
                    hftMetrics: hftCtx.hftMetrics ?? null,
                    replayStats: hftCtx.replayStats ?? null,
                    trades: hftCtx.hftTrades,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          ) : null}
        </Section>
      </div>

      <footer className="mt-8 border-t border-[var(--border-subtle)] pt-4 text-center text-[11px] text-[var(--text-tertiary)]">
        Report ID <span className="font-mono">{data.id}</span>
        {reportDate ? ` · ${reportDate}` : ""}
      </footer>
    </div>
  );
}
