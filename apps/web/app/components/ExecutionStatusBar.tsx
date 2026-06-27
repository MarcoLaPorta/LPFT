"use client";

import { useEffect, useState } from "react";

type ExecPoll = {
  executionStatus?: string;
  transactionHash?: string | null;
};

export function ExecutionStatusBar(props: {
  executionLogId: string | null;
  walletAddress: string;
}) {
  const { executionLogId, walletAddress } = props;
  const [data, setData] = useState<ExecPoll | null>(null);
  const [error, setError] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!executionLogId) {
      setData(null);
      setError(false);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `/api/execution/${executionLogId}?wallet=${encodeURIComponent(walletAddress)}`,
        );
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as ExecPoll;
        if (!cancelled) {
          setData(j);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [executionLogId, walletAddress]);

  async function sendFeedback(rating: "up" | "down") {
    if (!executionLogId) return;
    const comment =
      rating === "down"
        ? window.prompt("Commento opzionale (feedback negativo):")?.trim() || undefined
        : undefined;
    try {
      setFeedbackBusy(true);
      setFeedbackStatus(null);
      const res = await fetch(
        `/api/execution/${encodeURIComponent(executionLogId)}/feedback?wallet=${encodeURIComponent(walletAddress)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating, comment }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof json.error === "string" ? json.error : "Feedback non salvato");
      }
      setFeedbackStatus("Grazie per il feedback.");
    } catch (e) {
      setFeedbackStatus(e instanceof Error ? e.message : "Errore feedback");
    } finally {
      setFeedbackBusy(false);
    }
  }

  if (!executionLogId) return null;

  const statusLabel = error
    ? "Errore aggiornamento"
    : (data?.executionStatus ?? "In attesa");

  const statusClass =
    data?.executionStatus === "CONFIRMED"
      ? "text-[var(--success)]"
      : data?.executionStatus === "FAILED"
        ? "text-[var(--danger)]"
        : "text-[var(--accent)]";

  return (
    <div className="lpft-status-banner">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[var(--text-secondary)]">
        <span className="text-[var(--text-tertiary)]">Esecuzione</span>
        <span className={statusClass}>{statusLabel}</span>
        {data?.transactionHash ? (
          <span
            className="truncate font-mono text-[11px] text-[var(--text-tertiary)]"
            title={data.transactionHash}
          >
            {data.transactionHash}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={feedbackBusy}
          onClick={() => void sendFeedback("up")}
          className="lpft-btn-secondary px-2 py-1 text-[11px]"
        >
          Thumbs up
        </button>
        <button
          type="button"
          disabled={feedbackBusy}
          onClick={() => void sendFeedback("down")}
          className="lpft-btn-secondary px-2 py-1 text-[11px]"
        >
          Thumbs down
        </button>
        {feedbackStatus ? (
          <span className="text-[11px] text-[var(--text-tertiary)]">{feedbackStatus}</span>
        ) : null}
      </div>
    </div>
  );
}
