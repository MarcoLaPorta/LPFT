"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, type Time } from "lightweight-charts";
import type { ChartPoint } from "../../../lib/series-analytics";

export function SimpleLineChart({
  data,
  height = 200,
  color = "rgba(124, 58, 237, 0.85)",
  fill = "rgba(124, 58, 237, 0.12)",
  valueFormatter,
}: {
  data: ChartPoint[];
  height?: number;
  color?: string;
  fill?: string;
  valueFormatter?: (v: number) => string;
}) {
  const host = useRef<HTMLDivElement>(null);

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
      timeScale: { borderVisible: false },
      width: el.clientWidth,
      height,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: fill,
      bottomColor: "rgba(0,0,0,0)",
      lineWidth: 2,
    });
    series.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
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
