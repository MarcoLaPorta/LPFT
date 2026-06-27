"use client";

import { useEffect, useMemo, useState } from "react";
import { BacktestWidget, type BacktestPoint } from "./BacktestWidget";
import { OpenAnalysisLink } from "./OpenAnalysisLink";
import { useAfxStore } from "../../lib/afx-store";
import {
  displayUsdcToRaw,
  isValidUsdcDisplay,
  rawUsdcToDisplay,
  type ExecutionSizingPayload,
} from "../../lib/execution-user-sizing";
import { executionSizingLabel } from "../../lib/execution-ui-labels";

export type ProposeExecutionOutput = {
  executionLogId?: string;
  status?: string;
  marketRoutingMode?: string;
  symbol?: string;
  benchmark?: string;
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  series?: BacktestPoint[];
  rejected?: boolean;
  reason?: string;
  warning?: string | null;
  snapshotId?: string;
  reportUrl?: string;
  /** Sizing suggerito dal motore quant (default input USDC). */
  sizing?: ExecutionSizingPayload;
};

export function ProposeExecutionWidget({
  output,
  onExecuted,
  compact = false,
}: {
  output: ProposeExecutionOutput;
  onExecuted?: () => void;
  compact?: boolean;
}) {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [sizingMeta, setSizingMeta] = useState<ExecutionSizingPayload | null>(
    output.sizing ?? null,
  );
  const [amountUsdc, setAmountUsdc] = useState("0");

  useEffect(() => {
    if (output.sizing) {
      setSizingMeta(output.sizing);
      setAmountUsdc(rawUsdcToDisplay(output.sizing.amountIn));
      return;
    }
    if (!output.executionLogId || !walletAddress) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/execution/${encodeURIComponent(output.executionLogId!)}?wallet=${encodeURIComponent(walletAddress)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as { sizing?: ExecutionSizingPayload | null };
        if (cancelled || !j.sizing) return;
        setSizingMeta(j.sizing);
        setAmountUsdc(rawUsdcToDisplay(j.sizing.amountIn));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [output.executionLogId, output.sizing, walletAddress]);

  const amountRaw = useMemo(() => displayUsdcToRaw(amountUsdc), [amountUsdc]);
  const canConfirm =
    !!walletAddress &&
    !!sizingMeta?.tokenIn &&
    !!sizingMeta?.tokenOut &&
    amountRaw != null &&
    amountRaw > 0n &&
    isValidUsdcDisplay(amountUsdc) &&
    !busy &&
    !tx;

  if (output.rejected) {
    return (
      <div className="lpft-widget-panel lpft-widget-panel--danger">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em]">Esecuzione rifiutata</p>
        <p className="mt-1">{output.reason}</p>
      </div>
    );
  }

  if (!output.executionLogId) return null;

  const routeType =
    output.marketRoutingMode?.startsWith("PRIMARY") ? "PRIMARY" : "SECONDARY";

  async function onConfirm() {
    if (!canConfirm || !sizingMeta || amountRaw == null) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/execution/${encodeURIComponent(output.executionLogId!)}/execute?wallet=${encodeURIComponent(walletAddress)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeType,
            userSizing: {
              amountIn: amountRaw.toString(),
              tokenIn: sizingMeta.tokenIn,
              tokenOut: sizingMeta.tokenOut,
              fee: sizingMeta.fee,
            },
          }),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
      setTx(typeof j.transactionHash === "string" ? j.transactionHash : null);
      useAfxStore.getState().setLastExecutionLogId(output.executionLogId!);
      onExecuted?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Errore esecuzione");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lpft-widget-panel lpft-widget-panel--success space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--success)]">
            Proposta esecuzione · DRAFT
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
            {output.symbol} · routing {output.marketRoutingMode ?? "—"}
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-tertiary)]">
            {output.executionLogId}
          </p>
        </div>
        {!tx ? (
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => void onConfirm()}
            className="btn-primary shrink-0 rounded-[var(--radius)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Invio…" : "Conferma esecuzione"}
          </button>
        ) : (
          <span className="text-[11px] font-mono text-[var(--success)]">SUBMITTED</span>
        )}
      </div>

      {!tx ? (
        <div className="space-y-1.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3">
          <label
            htmlFor={`exec-amount-${output.executionLogId}`}
            className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]"
          >
            Importo USDC da investire
          </label>
          <input
            id={`exec-amount-${output.executionLogId}`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amountUsdc}
            onChange={(e) => setAmountUsdc(e.target.value)}
            placeholder="0.00"
            className="w-full max-w-xs rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <p className="text-[10px] text-[var(--text-tertiary)]">
            {executionSizingLabel(sizingMeta)}
          </p>
          {amountUsdc.trim() !== "" && !isValidUsdcDisplay(amountUsdc) ? (
            <p className="text-[11px] text-[var(--danger)]">
              Inserisci un importo valido (max 6 decimali).
            </p>
          ) : null}
          {!walletAddress ? (
            <p className="text-[11px] text-[var(--danger)]">Connetti il wallet per confermare.</p>
          ) : null}
        </div>
      ) : null}

      <OpenAnalysisLink reportUrl={output.reportUrl} snapshotId={output.snapshotId} />

      {!compact && output.metrics && output.series && output.series.length >= 2 && output.symbol && (
        <BacktestWidget
          symbol={output.symbol}
          benchmarkSymbol={output.benchmark ?? "^GSPC"}
          series={output.series}
          metrics={output.metrics}
        />
      )}

      {output.metrics && (!output.series || output.series.length < 2) && (
        <ul className="list-inside list-disc font-mono text-[11px] text-[var(--text-secondary)]">
          <li>Sharpe: {output.metrics.sharpe.toFixed(2)}</li>
          <li>CAGR: {(output.metrics.cagr * 100).toFixed(2)}%</li>
          <li>Max DD: {(output.metrics.maxDrawdown * 100).toFixed(1)}%</li>
        </ul>
      )}
      {output.warning ? (
        <p className="text-[11px] text-[var(--danger)]">{output.warning}</p>
      ) : null}

      {err ? <p className="text-[11px] text-[var(--danger)]">{err}</p> : null}
      {tx ? (
        <p className="break-all font-mono text-[10px] text-[var(--text-tertiary)]" title={tx}>
          tx: {tx}
        </p>
      ) : null}
    </div>
  );
}
