"use client";

import type { HFTScalpTrade } from "../../services/quant/hft-types";

function fmtBps(bps: number): string {
  const sign = bps >= 0 ? "+" : "";
  return `${sign}${bps.toFixed(1)} bps`;
}

export function HFTScalpTradeBars({ trades }: { trades: HFTScalpTrade[] }) {
  if (trades.length === 0) return null;
  const maxAbs = Math.max(...trades.map((t) => Math.abs(t.pnlBps)), 1);

  return (
    <div className="flex items-end gap-0.5" style={{ minHeight: 88 }}>
      {trades.map((t) => {
        const h = Math.max(4, (Math.abs(t.pnlBps) / maxAbs) * 100);
        return (
          <div
            key={t.tradeIndex}
            title={`#${t.tradeIndex} ${t.side} ${fmtBps(t.pnlBps)}`}
            className={[
              "min-w-[5px] flex-1 rounded-t",
              t.pnlBps >= 0 ? "bg-[var(--success)]" : "bg-[var(--danger)]",
            ].join(" ")}
            style={{ height: `${h}%` }}
          />
        );
      })}
    </div>
  );
}
