"use client";

import {
  ColorType,
  LineSeries,
  createChart,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef } from "react";

export type BacktestPoint = { date: string; equity: number; benchmark: number };

export type BacktestWidgetProps = {
  symbol: string;
  benchmarkSymbol: string;
  series: BacktestPoint[];
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  benchmarkMetrics?: { cagr: number; sharpe: number; maxDrawdown: number };
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
}: BacktestWidgetProps) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el || series.length < 2) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#71717a",
        fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { vertLine: { color: "rgba(139,92,246,0.35)" }, horzLine: { color: "rgba(139,92,246,0.2)" } },
      width: el.clientWidth,
      height: 260,
    });

    const eq = chart.addSeries(LineSeries, {
      color: "#a855f7",
      lineWidth: 2,
      title: "Equity strategia",
    });
    const bm = chart.addSeries(LineSeries, {
      color: "#52525b",
      lineWidth: 1,
      title: benchmarkSymbol,
    });

    const tData = series.map((p) => ({
      time: p.date as Time,
      value: p.equity,
    }));
    const bData = series.map((p) => ({
      time: p.date as Time,
      value: p.benchmark,
    }));
    eq.setData(tData);
    bm.setData(bData);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [series, benchmarkSymbol]);

  if (series.length < 2) {
    return (
      <p className="text-xs text-zinc-500">Dati insufficienti per il grafico.</p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-zinc-950/80 p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-violet-400/90">
            Backtest
          </p>
          <p className="font-mono text-sm text-zinc-200">
            {symbol}{" "}
            <span className="text-zinc-500">vs</span> {benchmarkSymbol}
          </p>
        </div>
      </div>
      {(metrics || benchmarkMetrics) && (
        <div className="grid grid-cols-2 gap-2 font-mono text-[11px] sm:grid-cols-3">
          {metrics && (
            <>
              <Metric label="CAGR" value={fmtPct(metrics.cagr, 2)} accent />
              <Metric label="Sharpe" value={metrics.sharpe.toFixed(2)} accent />
              <Metric label="Max DD" value={fmtPct(metrics.maxDrawdown, 1)} warn />
            </>
          )}
          {benchmarkMetrics && (
            <Metric label="Bench CAGR" value={fmtPct(benchmarkMetrics.cagr, 2)} />
          )}
        </div>
      )}
      <div ref={host} className="w-full min-h-[260px]" />
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
      className={`rounded border px-2 py-1.5 ${
        accent
          ? "border-violet-500/25 bg-violet-500/5 text-violet-200"
          : warn
            ? "border-amber-500/20 bg-amber-500/5 text-amber-200/90"
            : "border-white/10 bg-black/40 text-zinc-400"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-xs tabular-nums">{value}</p>
    </div>
  );
}
