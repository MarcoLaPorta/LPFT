"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("LPFT page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <h1 className="text-lg font-semibold">Si è verificato un errore</h1>
      <p className="text-sm text-[var(--text-secondary)] max-w-lg text-center font-mono break-words">
        {error.message || "Errore sconosciuto"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => (typeof reset === "function" ? reset() : window.location.reload())}
          className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm hover:bg-[rgba(255,255,255,0.06)]"
        >
          Riprova
        </button>
        <button
          type="button"
          onClick={() => (window.location.href = "/")}
          className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm hover:bg-[rgba(255,255,255,0.06)]"
        >
          Ricarica la pagina
        </button>
      </div>
    </div>
  );
}
