"use client";

/** Mostrato se il report non è stato salvato (migrazione DB mancante). */
export function SnapshotDbHint({ message }: { message?: string }) {
  return (
    <p className="rounded-lg border border-[var(--warning)]/30 bg-[rgba(255,214,10,0.06)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
      {message ?? (
        <>
          Per aprire il report serve Postgres. In terminale:{" "}
          <code className="block mt-1 text-[var(--text-primary)]">
            cd apps/web && DATABASE_URL=&quot;postgresql://…/afx_dev&quot; npx prisma migrate deploy
          </code>
        </>
      )}
    </p>
  );
}
