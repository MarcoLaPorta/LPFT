"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShellHeader } from "../components/AppShellHeader";
import { fmtPctFrac } from "../../lib/afx-derived-stats";
import { sourceLabel } from "../../lib/format-strategy-summary";
import { useAfxStore } from "../../lib/afx-store";

type SavedStrategy = {
  id: string;
  title: string | null;
  symbol: string;
  benchmark: string | null;
  source: string;
  intentSummary: string | null;
  intentClass: string | null;
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  savedAt: string;
  reportUrl: string;
};

export default function StrategiesPage() {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [items, setItems] = useState<SavedStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    useAfxStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/strategies?wallet=${encodeURIComponent(walletAddress)}`,
        );
        const j = await res.json();
        if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
        if (!cancelled) setItems((j.strategies ?? []) as SavedStrategy[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Errore caricamento");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  return (
    <div className="lpft-app-shell">
      <AppShellHeader activePath="/strategies" />

      <main className="lpft-page-main mx-auto max-w-5xl w-full">
        <section className="mb-6">
          <p className="lpft-page-tag">Libreria</p>
          <h1 className="lpft-page-title">Strategie salvate</h1>
          <p className="lpft-page-lead">
            Le strategie che salvi dalla chat o dal report di analisi. Clicca una card per aprire il report completo.
          </p>
        </section>

        {loading ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="lpft-report-skeleton h-36" />
            ))}
          </div>
        ) : error ? (
          <p className="mt-6 text-[13px] text-[var(--danger)]">{error}</p>
        ) : items.length === 0 ? (
          <div className="lpft-report-section mt-6 text-center">
            <p className="text-[14px] text-[var(--text-secondary)]">Nessuna strategia salvata.</p>
            <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
              Esegui un backtest in chat e usa &quot;Salva strategia&quot; sul widget.
            </p>
            <Link href="/" className="lpft-btn-secondary mt-4 inline-flex">
              Vai alla chat
            </Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {items.map((s) => (
              <li key={s.id}>
                <Link href={s.reportUrl} className="lpft-strategy-card block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[15px] font-semibold text-[var(--text-primary)]">
                        {s.title ?? s.symbol}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-[var(--text-tertiary)]">
                        {s.symbol}
                        {s.benchmark ? ` vs ${s.benchmark}` : ""}
                      </p>
                    </div>
                    <span className="lpft-report-chip shrink-0">{sourceLabel(s.source)}</span>
                  </div>
                  {s.intentSummary ? (
                    <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-[var(--text-secondary)]">
                      {s.intentSummary}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px]">
                    {s.metrics ? (
                      <>
                        <span className="text-[var(--text-tertiary)]">
                          CAGR{" "}
                          <span className="text-[var(--text-primary)]">{fmtPctFrac(s.metrics.cagr)}</span>
                        </span>
                        <span className="text-[var(--text-tertiary)]">
                          Sharpe{" "}
                          <span className="text-[var(--text-primary)]">{s.metrics.sharpe.toFixed(2)}</span>
                        </span>
                        <span className="text-[var(--text-tertiary)]">
                          DD{" "}
                          <span className="text-[var(--danger)]">{fmtPctFrac(s.metrics.maxDrawdown, 1)}</span>
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p className="mt-3 text-[10px] text-[var(--text-tertiary)]">
                    Salvata{" "}
                    {new Date(s.savedAt).toLocaleString("it-IT", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
