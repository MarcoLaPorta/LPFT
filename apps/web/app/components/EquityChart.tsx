"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  LineData,
  AreaSeries,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

interface EquityChartProps {
  data: LineData[];
  height?: number;
  loading?: boolean;
  colorMode?: "positive" | "negative" | "neutral";
  visibleRange?: { from: number; to: number } | null;
}

export function EquityChart({
  data,
  height = 320,
  loading,
  colorMode = "neutral",
  visibleRange = null,
}: EquityChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  const palette =
    colorMode === "positive"
      ? {
          lineColor: "rgba(21, 128, 61, 0.88)",
          topColor: "rgba(21, 128, 61, 0.12)",
          bottomColor: "rgba(0,0,0,0)",
        }
      : colorMode === "negative"
        ? {
            lineColor: "rgba(185, 28, 28, 0.88)",
            topColor: "rgba(185, 28, 28, 0.12)",
            bottomColor: "rgba(0,0,0,0)",
          }
        : {
            lineColor: "rgba(229,231,235,0.78)",
            topColor: "rgba(229,231,235,0.06)",
            bottomColor: "rgba(0,0,0,0)",
          };

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = createChart(chartRef.current, {
      width: chartRef.current.offsetWidth,
      height,
      layout: { background: { color: "#07070a" }, textColor: "rgba(229,231,235,0.6)" },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false },
    });
    const area = chart.addSeries(AreaSeries, {
      lineColor: palette.lineColor,
      topColor: palette.topColor,
      bottomColor: palette.bottomColor,
      lineWidth: 1,
    });
    area.setData(data);
    if (visibleRange) {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as UTCTimestamp as Time,
        to: visibleRange.to as UTCTimestamp as Time,
      });
    } else {
      chart.timeScale().fitContent();
    }
    chartInstance.current = chart;
    seriesRef.current = area;
    const handleResize = () => chart.applyOptions({ width: chartRef.current?.offsetWidth ?? 0 });
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartInstance.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.setData(data);
    }
    if (chartInstance.current) {
      if (visibleRange) {
        chartInstance.current.timeScale().setVisibleRange({
          from: visibleRange.from as UTCTimestamp as Time,
          to: visibleRange.to as UTCTimestamp as Time,
        });
      } else {
        chartInstance.current.timeScale().fitContent();
      }
    }
  }, [data, visibleRange]);

  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.applyOptions({
        lineColor: palette.lineColor,
        topColor: palette.topColor,
        bottomColor: palette.bottomColor,
      });
    }
  }, [palette.bottomColor, palette.lineColor, palette.topColor]);

  if (loading) {
    return (
      <div className="flex items-center justify-center bg-[var(--bg-tertiary)]" style={{ height }}>
        <span className="text-[13px] text-[var(--text-tertiary)]">Caricamento grafico…</span>
      </div>
    );
  }
  return <div ref={chartRef} className="overflow-hidden" style={{ height }} />;
}

export function parseEquityCsv(csvText: string): LineData[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((s) => s.trim());
  const timeIdx = header.findIndex((h) => h.toLowerCase() === "datetime" || h === "date" || h === "0");
  const valueIdx = header.findIndex((h) => h === "0" || h.toLowerCase() === "equity" || h === "value");
  const tIdx = timeIdx >= 0 ? timeIdx : 0;
  const vIdx = valueIdx >= 0 ? valueIdx : header.length - 1;
  const out: LineData[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim());
    const rawTime = parts[tIdx];
    const value = parseFloat(parts[vIdx]);
    if (Number.isNaN(value)) continue;
    let timeSec: number;
    if (/^\d{10,}$/.test(rawTime)) {
      timeSec = parseInt(rawTime, 10);
    } else {
      const d = new Date(rawTime);
      timeSec = Math.floor(d.getTime() / 1000);
    }
    if (!Number.isFinite(timeSec) || timeSec <= 0) continue;
    out.push({ time: timeSec as UTCTimestamp as Time, value });
  }
  return out.sort((a, b) => Number(a.time) - Number(b.time));
}
