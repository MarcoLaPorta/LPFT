"use client";

import { fmtPctFrac } from "../../lib/afx-derived-stats";

export function AnalysisTeaser({
  symbol,
  benchmark,
  metrics,
  hasProjections,
  source,
  tradeCount,
}: {
  symbol: string;
  benchmark?: string;
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  hasProjections?: boolean;
  source: string;
  tradeCount?: number;
}) {
  return (
    <div className="rounded-lg bg-[rgba(255,255,255,0.04)] px-3 py-2.5 text-[13px]">
      <p className="text-[var(--text-secondary)]">
        <span className="text-[var(--text-primary)]">{symbol}</span>
        {benchmark ? <span className="text-[var(--text-tertiary)]"> vs {benchmark}</span> : null}
        <span className="text-[var(--text-tertiary)]"> · {source}</span>
      </p>
      {metrics ? (
        <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
          CAGR {fmtPctFrac(metrics.cagr)} · Sharpe {metrics.sharpe.toFixed(2)} · DD{" "}
          {fmtPctFrac(metrics.maxDrawdown, 1)}
          {hasProjections ? " · proiezioni" : ""}
          {tradeCount != null && tradeCount > 0 ? ` · ${tradeCount} trade` : ""}
        </p>
      ) : (
        <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
          Dettagli nel pannello analisi →
        </p>
      )}
    </div>
  );
}
