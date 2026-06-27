"use client";

import type { SimulatedTrade } from "../../../services/quant/backtest";
import { fmtPctFrac } from "../../../lib/afx-derived-stats";

export function TradePnlBars({ trades }: { trades: SimulatedTrade[] }) {
  if (trades.length === 0) return null;
  const maxAbs = Math.max(...trades.map((t) => Math.abs(t.pnlFrac)), 0.01);

  return (
    <div className="flex items-end gap-0.5" style={{ minHeight: 120 }}>
      {trades.map((t) => {
        const h = Math.max(4, (Math.abs(t.pnlFrac) / maxAbs) * 100);
        return (
          <div
            key={t.tradeIndex}
            title={`#${t.tradeIndex} ${fmtPctFrac(t.pnlFrac, 2)}`}
            className={[
              "min-w-[6px] flex-1 rounded-t",
              t.pnlFrac >= 0 ? "bg-[var(--success)]" : "bg-[var(--danger)]",
            ].join(" ")}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}
