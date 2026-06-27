"use client";

import { useEffect, useState } from "react";
import { useAfxStore } from "../../lib/afx-store";
import type { ExecutionSizingPayload } from "../../lib/execution-user-sizing";
import { ExecutionStatusBar } from "./ExecutionStatusBar";
import {
  ProposeExecutionWidget,
  type ProposeExecutionOutput,
} from "./ProposeExecutionWidget";
import type { BacktestPoint } from "./BacktestWidget";

const CONFIRMABLE = new Set(["DRAFT", "PENDING_SIGNATURE"]);

type ReportExecutionConfirmProps = {
  executionLogId: string;
  symbol: string;
  benchmark?: string;
  marketRoutingMode?: string;
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  series?: BacktestPoint[];
  sizing?: ExecutionSizingPayload | null;
  snapshotId?: string;
  reportUrl?: string;
};

export function ReportExecutionConfirm(props: ReportExecutionConfirmProps) {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [executionStatus, setExecutionStatus] = useState<string | null>(null);
  const [sizing, setSizing] = useState<ExecutionSizingPayload | null>(props.sizing ?? null);

  useEffect(() => {
    if (!props.executionLogId || !walletAddress) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/execution/${encodeURIComponent(props.executionLogId)}?wallet=${encodeURIComponent(walletAddress)}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as {
          executionStatus?: string;
          sizing?: ExecutionSizingPayload | null;
        };
        if (cancelled) return;
        if (j.executionStatus) setExecutionStatus(j.executionStatus);
        if (j.sizing) setSizing(j.sizing);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.executionLogId, walletAddress]);

  const output: ProposeExecutionOutput = {
    executionLogId: props.executionLogId,
    symbol: props.symbol,
    benchmark: props.benchmark,
    marketRoutingMode: props.marketRoutingMode,
    metrics: props.metrics,
    series: props.series,
    sizing: sizing ?? undefined,
    snapshotId: props.snapshotId,
    reportUrl: props.reportUrl,
  };

  if (executionStatus && !CONFIRMABLE.has(executionStatus)) {
    return (
      <div className="mt-4 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
          Esecuzione on-chain
        </p>
        <ExecutionStatusBar
          executionLogId={props.executionLogId}
          walletAddress={walletAddress}
        />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <ProposeExecutionWidget output={output} compact />
    </div>
  );
}
