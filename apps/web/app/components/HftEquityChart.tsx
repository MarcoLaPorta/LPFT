"use client";

import { useEffect, useMemo, useRef } from "react";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import type { HFTScalpTrade } from "../../services/quant/hft-types";

function toUtcSeries(trades: HFTScalpTrade[]): { time: UTCTimestamp; value: number }[] {
  if (trades.length === 0) return [];
  const used = new Set<number>();
  const bump = (sec: number) => {
    let t = sec;
    while (used.has(t)) t += 1;
    used.add(t);
    return t as UTCTimestamp;
  };

  const points: { time: UTCTimestamp; value: number }[] = [
    { time: bump(Math.floor(trades[0].entryTs / 1000)), value: 1 },
  ];
  let eq = 1;
  for (const t of trades) {
    eq *= 1 + t.pnlBps / 10_000;
    points.push({ time: bump(Math.floor(t.exitTs / 1000)), value: eq });
  }
  return points;
}

export function HftEquityChart({
  trades,
  height = 160,
  color = "rgba(124, 58, 237, 0.85)",
  fill = "rgba(124, 58, 237, 0.12)",
}: {
  trades: HFTScalpTrade[];
  height?: number;
  color?: string;
  fill?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const data = useMemo(() => toUtcSeries(trades), [trades]);

  useEffect(() => {
    const el = host.current;
    if (!el || data.length < 2) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(229,231,235,0.45)",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true },
      width: el.clientWidth,
      height,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: fill,
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
    });
    series.setData(data);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height, color, fill]);

  if (data.length < 2) {
    return <p className="text-[11px] text-[var(--text-tertiary)]">Dati insufficienti.</p>;
  }

  return <div ref={host} className="w-full" style={{ height }} />;
}
