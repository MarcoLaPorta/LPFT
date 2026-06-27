"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAfxStore } from "../../lib/afx-store";
import type { AnalysisReportPayload } from "./AnalysisReportButton";
import { SnapshotDbHint } from "./SnapshotDbHint";

type Props = {
  snapshotId?: string | null;
  reportUrl?: string | null;
  payload?: AnalysisReportPayload | null;
  defaultTitle?: string;
  /** Evita doppio salvataggio per lo stesso widget */
  cacheKey?: string;
  compact?: boolean;
  initialSaved?: boolean;
  hideReportLink?: boolean;
};

export function SaveStrategyActions({
  snapshotId: initialSnapshotId,
  reportUrl: initialReportUrl,
  payload,
  defaultTitle,
  cacheKey,
  compact = false,
  initialSaved = false,
  hideReportLink = false,
}: Props) {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [snapshotId, setSnapshotId] = useState<string | null>(initialSnapshotId ?? null);
  const [reportUrl, setReportUrl] = useState<string | null>(
    initialReportUrl ?? (initialSnapshotId ? `/analysis/${initialSnapshotId}` : null),
  );
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPersist = (payload?.series?.length ?? 0) >= 2 || Boolean(snapshotId);

  useEffect(() => {
    setSnapshotId(initialSnapshotId ?? null);
    setReportUrl(initialReportUrl ?? (initialSnapshotId ? `/analysis/${initialSnapshotId}` : null));
    setSaved(initialSaved);
    setError(null);
  }, [cacheKey, initialSnapshotId, initialReportUrl, initialSaved]);

  useEffect(() => {
    if (!snapshotId || saved) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/analysis/snapshots/${encodeURIComponent(snapshotId)}?wallet=${encodeURIComponent(walletAddress)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as { savedAt?: string | null };
        if (!cancelled && j.savedAt) setSaved(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [snapshotId, walletAddress, cacheKey]);

  const onSave = useCallback(async () => {
    if (!canPersist || saving || saved) return;
    setSaving(true);
    setError(null);
    try {
      if (snapshotId) {
        const res = await fetch(
          `/api/strategies/${encodeURIComponent(snapshotId)}/save?wallet=${encodeURIComponent(walletAddress)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: defaultTitle ?? payload?.intentSummary ?? payload?.symbol }),
          },
        );
        const j = await res.json();
        if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
        setSaved(true);
        return;
      }

      if (!payload) throw new Error("Dati strategia non disponibili");

      const res = await fetch(
        `/api/analysis/snapshots?wallet=${encodeURIComponent(walletAddress)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, saved: true, title: defaultTitle ?? payload.intentSummary ?? payload.symbol }),
        },
      );
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
      setSnapshotId(String(j.snapshotId));
      setReportUrl(String(j.reportUrl ?? `/analysis/${j.snapshotId}`));
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Salvataggio fallito");
    } finally {
      setSaving(false);
    }
  }, [canPersist, saving, saved, snapshotId, walletAddress, payload, defaultTitle]);

  if (!canPersist) return null;

  const href = reportUrl ?? (snapshotId ? `/analysis/${snapshotId}` : null);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "pt-1" : "pt-2"}`}>
      {saved ? (
        <span className="inline-flex items-center rounded-lg border border-[rgba(50,215,75,0.35)] bg-[rgba(50,215,75,0.1)] px-2.5 py-1 text-[11px] font-medium text-[var(--success)]">
          Salvata in libreria
        </span>
      ) : (
        <button
          type="button"
          disabled={saving}
          onClick={() => void onSave()}
          className="lpft-btn-secondary text-[11px] font-semibold uppercase tracking-wide"
        >
          {saving ? "Salvataggio…" : "Salva strategia"}
        </button>
      )}
      {href && !hideReportLink ? (
        <Link href={href} className="lpft-btn-secondary text-[11px] font-semibold uppercase tracking-wide">
          Apri report
        </Link>
      ) : null}
      {!saved && !snapshotId && !saving ? <SnapshotDbHint /> : null}
      {error ? <SnapshotDbHint message={error} /> : null}
    </div>
  );
}
