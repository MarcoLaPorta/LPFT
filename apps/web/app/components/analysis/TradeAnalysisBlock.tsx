"use client";

import { fmtPctFrac } from "../../../lib/afx-derived-stats";
import { TRADE_PNL_PCT_HINT_IT } from "../../../lib/backtestMetrics";
import type { TradeSummary } from "../../../lib/trade-stats";
import type { SimulatedTrade } from "../../../services/quant/backtest";
import { TradePnlBars } from "./TradePnlBars";
import { TradeRegistryTable } from "./TradeRegistryTable";

type Props = {
  trades: SimulatedTrade[];
  summary: TradeSummary | null;
};

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

export function TradeAnalysisBlock({ trades, summary }: Props) {
  if (!summary) {
    return <TradeRegistryTable trades={trades} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-snug text-[var(--text-tertiary)]">{TRADE_PNL_PCT_HINT_IT}</p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCell label="N. trade" value={String(summary.count)} accent />
        <MetricCell label="Win rate" value={fmtPctFrac(summary.winRate, 1)} />
        <MetricCell label="Profit factor" value={summary.profitFactor.toFixed(2)} />
        <MetricCell label="PnL medio" value={fmtPctFrac(summary.avgPnlFrac, 2)} />
        <MetricCell label="Hold medio" value={`${summary.avgHoldDays.toFixed(1)} gg`} />
        <MetricCell label="Vincita media" value={fmtPctFrac(summary.avgWinFrac, 2)} />
        <MetricCell label="Perdita media" value={fmtPctFrac(summary.avgLossFrac, 2)} warn />
        <MetricCell label="Best" value={fmtPctFrac(summary.bestFrac, 2)} />
        <MetricCell label="Worst" value={fmtPctFrac(summary.worstFrac, 2)} warn />
      </div>
      <div id="trade" className="w-full min-w-0">
        <TradeRegistryTable trades={trades} />
      </div>
      {trades.length > 0 ? (
        <div className="w-full border-t border-[var(--border-subtle)] pt-4">
          <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">PnL per trade</p>
          <TradePnlBars trades={trades} />
        </div>
      ) : null}
    </div>
  );
}
