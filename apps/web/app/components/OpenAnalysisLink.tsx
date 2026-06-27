"use client";

import Link from "next/link";

export function OpenAnalysisLink({
  reportUrl,
  snapshotId,
  className = "",
}: {
  reportUrl?: string | null;
  snapshotId?: string | null;
  className?: string;
}) {
  const href = reportUrl ?? (snapshotId ? `/analysis/${snapshotId}` : null);
  if (!href) return null;

  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={[
        "inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-muted)] bg-[var(--accent-muted)] px-3 py-1.5",
        "text-[11px] font-semibold uppercase tracking-wide text-[var(--text-primary)]",
        "hover:border-[var(--accent)] hover:bg-[var(--accent-strong)] transition-colors",
        className,
      ].join(" ")}
    >
      Apri report analisi
      <span aria-hidden className="text-[var(--text-tertiary)]">↗</span>
    </Link>
  );
}
