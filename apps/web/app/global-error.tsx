"use client";

import Link from "next/link";

/**
 * Errore fuori dal layout normale (es. crash del root layout).
 * Mostra un messaggio leggibile invece di una pagina bianca.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="it">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#050507",
          color: "#e5e7eb",
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>LPFT — errore globale</h1>
        <p style={{ fontSize: 13, color: "rgba(229,231,235,0.72)", maxWidth: 480, marginTop: 12 }}>
          {error.message || "Errore sconosciuto"}
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
          <button
            type="button"
            onClick={() => (typeof reset === "function" ? reset() : window.location.reload())}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "#e5e7eb",
              cursor: "pointer",
            }}
          >
            Riprova
          </button>
          <Link
            href="/"
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#e5e7eb",
              textDecoration: "none",
            }}
          >
            Home
          </Link>
        </div>
        <p style={{ fontSize: 11, color: "rgba(229,231,235,0.45)", marginTop: 24 }}>
          Se vedi spesso questo messaggio: ferma Next, esegui <code>npm run dev:restart</code> in{" "}
          <code>apps/web</code> (libera la porta 3000 e ricostruisce la cache).
        </p>
      </body>
    </html>
  );
}
