"use client";

import { BacktestWidget, type BacktestPoint } from "./BacktestWidget";

export type QuantStrategyOutput = {
  success: boolean;
  intentClass?: string;
  intentSummary?: string;
  symbol?: string;
  benchmark?: string;
  series?: BacktestPoint[];
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  benchmarkMetrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  engineSpec?: { kind: string };
  marketRoutingMode?: string;
  riskCapsApplied?: {
    maxDrawdownLimit: number;
    stopLossPercentage: number;
    trailingStop: boolean;
  };
  errors?: string[];
  snapshotId?: string;
  reportUrl?: string;
  tradeCount?: number;
};

function intentLabel(c: string | undefined) {
  if (c === "WALLET_MANAGEMENT") return "Wallet Management";
  if (c === "ALGORITHMIC_TRADING") return "Algorithmic Trading";
  if (c === "HIGH_FREQUENCY_SCALPING") return "High-Frequency Scalping";
  return c ?? "—";
}

export function QuantStrategyWidget({
  output,
  compact = false,
}: {
  output: QuantStrategyOutput;
  compact?: boolean;
}) {
  if (!output.success) {
    return (
      <div className="rounded-lg border border-[rgba(255,59,48,0.35)] bg-[rgba(255,59,48,0.06)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--danger)]">
          Compilazione strategia fallita
        </p>
        <ul className="mt-2 list-inside list-disc font-mono text-[11px] text-[var(--text-secondary)]">
          {(output.errors ?? ["Errore sconosciuto"]).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  const sym = output.symbol ?? "—";
  const bench = output.benchmark ?? "^GSPC";
  const series = output.series ?? [];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
          Quant Engine · Strategia compilata
        </p>
        <p className="mt-1 font-mono text-[11px] text-[var(--text-primary)]">
          {intentLabel(output.intentClass)}
          {output.engineSpec?.kind ? (
            <span className="text-[var(--text-tertiary)]"> · engine {output.engineSpec.kind}</span>
          ) : null}
        </p>
        {output.intentSummary ? (
          <p className="mt-2 text-[12px] leading-snug text-[var(--text-secondary)]">
            {output.intentSummary}
          </p>
        ) : null}
        {output.tradeCount != null && output.tradeCount > 0 ? (
          <p className="mt-2 font-mono text-[10px] text-[var(--text-tertiary)]">
            {output.tradeCount} transazioni simulate
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-[var(--text-tertiary)]">
          {output.marketRoutingMode ? (
            <span className="rounded border border-[var(--border-subtle)] px-2 py-0.5">
              routing {output.marketRoutingMode}
            </span>
          ) : null}
          {output.riskCapsApplied ? (
            <span className="rounded border border-[var(--border-subtle)] px-2 py-0.5">
              max DD {(output.riskCapsApplied.maxDrawdownLimit * 100).toFixed(0)}% · SL{" "}
              {(output.riskCapsApplied.stopLossPercentage * 100).toFixed(0)}%
              {output.riskCapsApplied.trailingStop ? " · trailing" : ""}
            </span>
          ) : null}
        </div>
      </div>

      {!compact && series.length >= 2 ? (
        <BacktestWidget
          symbol={sym}
          benchmarkSymbol={bench}
          series={series}
          metrics={output.metrics}
          benchmarkMetrics={output.benchmarkMetrics}
        />
      ) : null}
    </div>
  );
}
