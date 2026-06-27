"use client";

import type { MonthlyReturnRow } from "../../../lib/series-analytics";
import { fmtPctFrac } from "../../../lib/afx-derived-stats";

export function MonthlyReturnsBars({ rows }: { rows: MonthlyReturnRow[] }) {
  if (rows.length === 0) return null;
  const maxAbs = Math.max(...rows.flatMap((r) => [Math.abs(r.strat), Math.abs(r.bench)]), 0.01);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-4 text-[10px] text-[var(--text-tertiary)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded bg-[var(--accent)]" /> Strategia
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded bg-[rgba(229,231,235,0.35)]" /> Benchmark
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.month} className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[10px]">
            <span className="font-mono text-[var(--text-tertiary)]">{r.month}</span>
            <div className="space-y-1">
              <Bar value={r.strat} maxAbs={maxAbs} color="var(--accent)" label={fmtPctFrac(r.strat, 1)} />
              <Bar value={r.bench} maxAbs={maxAbs} color="rgba(229,231,235,0.45)" label={fmtPctFrac(r.bench, 1)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bar({ value, maxAbs, color, label }: { value: number; maxAbs: number; color: string; label: string }) {
  const w = Math.min(100, (Math.abs(value) / maxAbs) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${w}%`, backgroundColor: color, marginLeft: value < 0 ? `${100 - w}%` : 0 }}
        />
      </div>
      <span
        className={[
          "w-12 shrink-0 text-right font-mono tabular-nums",
          value >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]",
        ].join(" ")}
      >
        {label}
      </span>
    </div>
  );
}
