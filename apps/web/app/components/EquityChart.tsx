"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  createSeriesMarkers,
  IChartApi,
  ISeriesApi,
  LineData,
  AreaSeries,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

export type EquityChartMarker = {
  time: Time;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text?: string;
};

interface EquityChartProps {
  data: LineData[];
  height?: number;
  loading?: boolean;
  colorMode?: "positive" | "negative" | "neutral";
  visibleRange?: { from: number; to: number } | null;
  markers?: EquityChartMarker[];
}

export function EquityChart({
  data,
  height = 320,
  loading,
  colorMode = "neutral",
  visibleRange = null,
  markers = [],
}: EquityChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersPrimitiveRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

  const palette = useMemo(
    () =>
      colorMode === "positive"
        ? {
            lineColor: "rgba(50, 215, 75, 0.9)",
            topColor: "rgba(50, 215, 75, 0.14)",
            bottomColor: "rgba(0,0,0,0)",
          }
        : colorMode === "negative"
          ? {
              lineColor: "rgba(255, 69, 58, 0.88)",
              topColor: "rgba(255, 69, 58, 0.12)",
              bottomColor: "rgba(0,0,0,0)",
            }
          : {
              /* Neutro: accento viola LPFT (allineato a globals --accent) */
              lineColor: "rgba(124, 58, 237, 0.82)",
              topColor: "rgba(124, 58, 237, 0.14)",
              bottomColor: "rgba(0,0,0,0)",
            },
    [colorMode]
  );

  useEffect(() => {
    if (!chartRef.current) return;
    const el = chartRef.current;
    const chart = createChart(el, {
      width: Math.max(1, el.clientWidth || el.offsetWidth || 300),
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
    area.setData([]);
    markersPrimitiveRef.current = createSeriesMarkers(area, []);
    chart.timeScale().fitContent();
    chartInstance.current = chart;
    seriesRef.current = area;
    const handleResize = () => {
      if (!chartRef.current) return;
      const w = Math.max(1, chartRef.current.clientWidth || chartRef.current.offsetWidth);
      chart.applyOptions({ width: w });
    };
    window.addEventListener("resize", handleResize);
    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    requestAnimationFrame(handleResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", handleResize);
      markersPrimitiveRef.current = null;
      chart.remove();
      chartInstance.current = null;
      seriesRef.current = null;
    };
  }, [height, palette]);

  useEffect(() => {
    if (seriesRef.current) {
      seriesRef.current.setData(data);
    }
    if (markersPrimitiveRef.current) {
      markersPrimitiveRef.current.setMarkers(markers);
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
  }, [data, markers, visibleRange]);

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

export { parseEquityCsv } from "../../lib/equityCsv";
