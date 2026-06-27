"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { StrategyReportView, type StrategyReportData } from "../../components/StrategyReportView";
import { useAfxStore } from "../../../lib/afx-store";

function ReportSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
      <div className="lpft-report-skeleton h-40" />
      <div className="mt-4 lpft-report-skeleton h-10" />
      <div className="mt-4 lpft-report-skeleton h-72" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="lpft-report-skeleton h-20" />
        ))}
      </div>
    </div>
  );
}

export default function AnalysisReportPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [data, setData] = useState<StrategyReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    useAfxStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/analysis/snapshots/${encodeURIComponent(id)}?wallet=${encodeURIComponent(walletAddress)}`,
        );
        const j = await res.json();
        if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
        if (!cancelled) setData(j as StrategyReportData);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Errore caricamento");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, walletAddress]);

  return (
    <div className="lpft-report-shell">
      <header className="lpft-report-header">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2 hover:opacity-90">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-gradient-to-br from-[rgba(124,58,237,0.35)] to-[rgba(0,0,0,0.5)] text-[12px] font-bold">
              L
            </div>
            <span className="hidden text-[13px] font-semibold sm:inline">LPFT · Report</span>
          </Link>
          {id ? (
            <span className="truncate font-mono text-[10px] text-[var(--text-tertiary)]">{id.slice(0, 12)}…</span>
          ) : null}
        </div>
        <nav className="flex shrink-0 items-center gap-2 text-[12px]">
          <Link href="/strategies" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Strategie
          </Link>
          <Link href="/exchange" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
            Mercati
          </Link>
          <Link href="/" className="lpft-btn-secondary">
            Chat
          </Link>
        </nav>
      </header>

      {loading ? (
        <ReportSkeleton />
      ) : error ? (
        <div className="mx-auto max-w-lg p-8 text-center">
          <p className="text-[15px] font-medium text-[var(--danger)]">{error}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            Verifica DATABASE_URL e migrazioni Prisma. Esegui{" "}
            <code className="font-mono text-[var(--text-secondary)]">npx prisma migrate deploy</code>
          </p>
          <Link href="/" className="lpft-btn-secondary mt-5 inline-flex">
            Torna alla chat
          </Link>
        </div>
      ) : data ? (
        <StrategyReportView data={data} />
      ) : null}
    </div>
  );
}
