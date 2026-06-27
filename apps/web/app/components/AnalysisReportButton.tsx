"use client";

import { useEffect, useRef, useState } from "react";
import { useAfxStore } from "../../lib/afx-store";
import { OpenAnalysisLink } from "./OpenAnalysisLink";
import { SnapshotDbHint } from "./SnapshotDbHint";
export type AnalysisReportPayload = {
  source: string;
  symbol: string;
  benchmark?: string;
  intentClass?: string;
  intentSummary?: string;
  compiledStrategy?: unknown;
  engineSpec?: unknown;
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  benchmarkMetrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  series?: { date: string; equity: number; benchmark: number }[];
  projections?: unknown;
  trades?: unknown[];
  marketRoutingMode?: string;
  riskCapsApplied?: unknown;
  executionLogId?: string;
};

export function AnalysisReportButton({
  payload,
  snapshotId: initialId,
  reportUrl: initialUrl,
  cacheKey,
}: {
  payload: AnalysisReportPayload;
  snapshotId?: string | null;
  reportUrl?: string | null;
  /** Id univoco (es. toolCallId) per salvare una sola volta */
  cacheKey: string;
}) {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [snapshotId, setSnapshotId] = useState<string | null>(initialId ?? null);
  const [reportUrl, setReportUrl] = useState<string | null>(initialUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const attempted = useRef(false);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;

  const canSave = (payload.series?.length ?? 0) >= 2;

  useEffect(() => {
    attempted.current = false;
    setError(null);
  }, [cacheKey]);

  useEffect(() => {
    if (initialId) {
      setSnapshotId(initialId);
      setReportUrl(initialUrl ?? `/analysis/${initialId}`);
    }
  }, [initialId, initialUrl, cacheKey]);

  useEffect(() => {
    if (snapshotId || !canSave || attempted.current) return;
    attempted.current = true;

    let cancelled = false;
    (async () => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/analysis/snapshots?wallet=${encodeURIComponent(walletAddress)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payloadRef.current),
          },
        );
        const j = await res.json();
        if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
        if (!cancelled) {
          setSnapshotId(String(j.snapshotId));
          setReportUrl(String(j.reportUrl ?? `/analysis/${j.snapshotId}`));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Salvataggio fallito");
      } finally {
        if (!cancelled) setSaving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [snapshotId, canSave, walletAddress, cacheKey]);

  if (!canSave) return null;

  return (
    <div className="flex flex-col gap-2 pt-1">
      {saving ? (
        <p className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
          Preparazione report…
        </p>
      ) : snapshotId ? (
        <OpenAnalysisLink reportUrl={reportUrl} snapshotId={snapshotId} />
      ) : null}
      {error ? <SnapshotDbHint message={error} /> : null}
      {!snapshotId && !saving && !error ? <SnapshotDbHint /> : null}
    </div>
  );
}
