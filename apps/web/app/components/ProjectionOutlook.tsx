"use client";

import type { ForwardProjection } from "../../services/quant/backtest";
import type { ProjectionsBundle } from "../../lib/afx-analysis-types";
import { fmtMultiple, fmtPctFrac } from "../../lib/afx-derived-stats";

function horizonLabel(days: number) {
  if (days <= 35) return "30g";
  if (days <= 100) return "90g";
  return "1a";
}

function ProjectionRow({
  label,
  p,
  baseEquity,
  compact = false,
}: {
  label: string;
  p: ForwardProjection;
  baseEquity: number;
  compact?: boolean;
}) {
  const expRet = p.expectedEquityMultiple - 1;
  const p05Ret = p.p05EquityMultiple - 1;
  const p95Ret = p.p95EquityMultiple - 1;
  const expVal = baseEquity * p.expectedEquityMultiple;

  if (compact) {
    return (
      <div className="flex items-center justify-between gap-2 py-0.5 text-[12px]">
        <span className="text-[var(--text-tertiary)]">{label}</span>
        <span className="font-mono tabular-nums text-[var(--text-primary)]">
          {fmtPctFrac(expRet, 1)}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold text-[var(--text-primary)]">{label}</span>
        <span className="text-[10px] text-[var(--text-tertiary)]">lookback {p.lookbackDays}g</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 font-mono text-[10px]">
        <div>
          <p className="text-[var(--text-tertiary)]">P05</p>
          <p className={p05Ret >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}>
            {fmtPctFrac(p05Ret, 1)}
          </p>
        </div>
        <div>
          <p className="text-[var(--accent)]">Atteso</p>
          <p className="text-[var(--text-primary)]">{fmtPctFrac(expRet, 1)}</p>
          <p className="text-[9px] text-[var(--text-tertiary)]">{fmtMultiple(p.expectedEquityMultiple)}</p>
        </div>
        <div>
          <p className="text-[var(--text-tertiary)]">P95</p>
          <p className={p95Ret >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}>
            {fmtPctFrac(p95Ret, 1)}
          </p>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
        <div
          className="relative h-full rounded-full bg-gradient-to-r from-[var(--danger)] via-[var(--accent)] to-[var(--success)] opacity-70"
          style={{
            marginLeft: `${Math.max(0, Math.min(45, ((p05Ret + 0.25) / 0.5) * 45))}%`,
            width: `${Math.max(10, Math.min(55, ((p95Ret - p05Ret + 0.15) / 0.5) * 55))}%`,
          }}
        />
      </div>
      <p className="mt-1.5 text-[9px] text-[var(--text-tertiary)]">
        Equity attesa (norm. {baseEquity.toFixed(2)}):{" "}
        <span className="font-mono text-[var(--text-secondary)]">{expVal.toFixed(3)}</span>
      </p>
    </div>
  );
}

export function ProjectionOutlook({
  projections,
  baseEquity = 1,
  compact = false,
}: {
  projections: ProjectionsBundle;
  baseEquity?: number;
  compact?: boolean;
}) {
  const entries: { label: string; p: ForwardProjection }[] = [
    { label: horizonLabel(projections.days30.horizonDays), p: projections.days30 },
    { label: horizonLabel(projections.days90.horizonDays), p: projections.days90 },
    { label: horizonLabel(projections.days365.horizonDays), p: projections.days365 },
  ];

  const mc = projections.days365.mcTerminalMultiples;
  const hist =
    mc && mc.length > 0
      ? (() => {
          const bins = 12;
          const min = Math.min(...mc);
          const max = Math.max(...mc);
          const span = max - min || 1;
          const counts = Array(bins).fill(0);
          for (const v of mc) {
            const i = Math.min(bins - 1, Math.floor(((v - min) / span) * bins));
            counts[i]++;
          }
          const peak = Math.max(...counts, 1);
          return counts.map((c) => c / peak);
        })()
      : null;

  return (
    <div className="space-y-2">
      {!compact ? (
        <p className="lpft-panel-header text-[var(--accent)]">Proiezioni forward (log-normal)</p>
      ) : (
        <p className="text-[11px] text-[var(--text-tertiary)]">Proiezioni</p>
      )}
      <div className={compact ? "space-y-0.5" : "space-y-2"}>
        {entries.map(({ label, p }) => (
          <ProjectionRow
            key={label}
            label={label}
            p={p}
            baseEquity={baseEquity}
            compact={compact}
          />
        ))}
      </div>
      {!compact && hist ? (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
            Distribuzione MC · orizzonte 1a ({mc!.length} path)
          </p>
          <div className="mt-2 flex h-14 items-end gap-0.5">
            {hist.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t bg-[var(--accent-muted)]"
                style={{ height: `${Math.max(4, h * 100)}%` }}
                title={`Bin ${i + 1}`}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
