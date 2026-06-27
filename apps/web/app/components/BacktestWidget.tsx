"use client";

import {
  ColorType,
  LineSeries,
  createChart,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import { toAscChartLineData } from "../../lib/chart-time";
import type { BacktestPointView } from "../../lib/afx-analysis-types";

export type BacktestPoint = BacktestPointView;

export type BacktestWidgetProps = {
  symbol: string;
  benchmarkSymbol: string;
  series: BacktestPoint[];
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  benchmarkMetrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  height?: number;
  /** Legenda viola = strategia, grigio = benchmark */
  showLegend?: boolean;
  /** Mostra la linea del benchmark (mercato) nel grafico */
  showBenchmark?: boolean;
  /** Nasconde la griglia metriche sotto il titolo (report page le ha già a parte) */
  compactMetrics?: boolean;
};

function fmtPct(x: number, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function BacktestWidget({
  symbol,
  benchmarkSymbol,
  series,
  metrics,
  benchmarkMetrics,
  height = 240,
  showLegend = false,
  showBenchmark = true,
  compactMetrics = false,
}: BacktestWidgetProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || series.length < 2) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(229,231,235,0.5)",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      width: el.clientWidth,
      height,
    });

    const eq = chart.addSeries(LineSeries, {
      color: "rgba(124, 58, 237, 0.9)",
      lineWidth: 2,
    });

    eq.setData(toAscChartLineData(series, (p) => p.equity));

    if (showBenchmark) {
      const bm = chart.addSeries(LineSeries, {
        color: "rgba(229,231,235,0.35)",
        lineWidth: 1,
      });
      bm.setData(toAscChartLineData(series, (p) => p.benchmark));
    }

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [series, benchmarkSymbol, symbol, height, showBenchmark]);

  if (series.length < 2) {
    return <p className="text-xs text-[var(--text-tertiary)]">Dati insufficienti per il grafico.</p>;
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
          Backtest
        </p>
        <p className="font-mono text-[12px] text-[var(--text-primary)]">
          {symbol}
          {showBenchmark ? (
            <>
              {" "}
              <span className="text-[var(--text-tertiary)]">vs</span> {benchmarkSymbol}
            </>
          ) : null}
        </p>
      </div>
      {showLegend && showBenchmark ? (
        <div className="flex flex-wrap gap-4 font-mono text-[10px] text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-6 rounded bg-[rgba(124,58,237,0.9)]" />
            Strategia ({symbol})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-6 rounded bg-[rgba(229,231,235,0.45)]" />
            Mercato ({benchmarkSymbol})
          </span>
        </div>
      ) : null}
      {!compactMetrics && (metrics || benchmarkMetrics) ? (
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px] sm:grid-cols-4">
          {metrics ? (
            <>
              <Metric label="CAGR" value={fmtPct(metrics.cagr, 2)} accent />
              <Metric label="Sharpe" value={metrics.sharpe.toFixed(2)} accent />
              <Metric label="Max DD" value={fmtPct(metrics.maxDrawdown, 1)} warn />
            </>
          ) : null}
          {benchmarkMetrics ? (
            <>
              <Metric label="Bench CAGR" value={fmtPct(benchmarkMetrics.cagr, 2)} />
              <Metric label="Bench Sharpe" value={benchmarkMetrics.sharpe.toFixed(2)} />
              <Metric label="Bench Max DD" value={fmtPct(benchmarkMetrics.maxDrawdown, 1)} warn />
            </>
          ) : null}
        </div>
      ) : null}
      <div ref={host} className="w-full" style={{ minHeight: height }} />
    </div>
  );
}

function Metric({
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
        "rounded border px-2 py-1.5",
        accent
          ? "border-[var(--accent-muted)] bg-[var(--accent-muted)] text-[var(--text-primary)]"
          : warn
            ? "border-[rgba(255,214,10,0.25)] bg-[rgba(255,214,10,0.06)] text-[var(--warning)]"
            : "border-[var(--border-subtle)] text-[var(--text-secondary)]",
      ].join(" ")}
    >
      <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{label}</p>
      <p className="tabular-nums text-xs">{value}</p>
    </div>
  );
}
