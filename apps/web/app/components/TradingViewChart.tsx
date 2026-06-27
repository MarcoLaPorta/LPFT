"use client";

import { useEffect, useId, useRef } from "react";

declare global {
  interface Window {
    TradingView?: {
      widget: new (config: Record<string, unknown>) => { remove?: () => void };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

function ensureTradingViewScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.TradingView) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const src = "https://s3.tradingview.com/tv.js";
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("TradingView script")), { once: true });
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("TradingView script"));
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export function TradingViewChart({
  symbol,
  interval = "D",
  fill = false,
}: {
  symbol: string;
  interval?: string;
  /** Riempie l’altezza del contenitore padre (exchange). */
  fill?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<{ remove?: () => void } | null>(null);
  const reactId = useId().replace(/:/g, "");
  const containerId = `tv_embed_${reactId}`;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.id = containerId;
    let cancelled = false;

    const run = async () => {
      try {
        await ensureTradingViewScript();
        if (cancelled || !el.isConnected) return;
        widgetRef.current?.remove?.();
        widgetRef.current = null;
        el.innerHTML = "";
        const TV = window.TradingView;
        if (!TV) {
          el.innerHTML =
            '<p class="p-4 text-[13px] text-[var(--danger)]">TradingView non disponibile (script bloccato?).</p>';
          return;
        }
        widgetRef.current = new TV.widget({
          autosize: true,
          symbol,
          interval,
          timezone: "America/New_York",
          theme: "dark",
          style: "1",
          locale: "it",
          enable_publishing: false,
          allow_symbol_change: false,
          container_id: containerId,
        });
      } catch {
        if (!cancelled && el.isConnected) {
          el.innerHTML =
            '<p class="p-4 text-[13px] text-[var(--danger)]">Impossibile caricare il widget TradingView.</p>';
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
      widgetRef.current?.remove?.();
      widgetRef.current = null;
      el.innerHTML = "";
    };
  }, [symbol, interval, containerId]);

  return (
    <div
      ref={containerRef}
      className={[
        "w-full bg-[var(--bg-tertiary)]",
        fill ? "h-full min-h-0 flex-1" : "min-h-[420px]",
      ].join(" ")}
    />
  );
}
