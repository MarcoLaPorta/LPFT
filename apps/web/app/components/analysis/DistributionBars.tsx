"use client";

export function DistributionBars({
  buckets,
}: {
  buckets: { label: string; count: number }[];
}) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="space-y-2">
      {buckets.map((b) => (
        <div key={b.label} className="grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2 text-[11px]">
          <span className="text-[var(--text-tertiary)]">{b.label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
            <div
              className="h-full rounded-full bg-[var(--accent-muted)]"
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="text-right font-mono text-[var(--text-secondary)]">{b.count}</span>
        </div>
      ))}
    </div>
  );
}
