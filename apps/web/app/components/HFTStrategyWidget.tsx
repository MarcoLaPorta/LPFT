"use client";

import type { HFTSessionResult, HFTStrategyConfig } from "../../services/quant/hft-types";
import type { HFTSessionMetrics } from "../../services/quant/hft-metrics";
import { HFTScalpTradeBars } from "./HFTScalpTradeBars";
import { HftEquityChart } from "./HftEquityChart";
import { SaveStrategyActions } from "./SaveStrategyActions";
import type { AnalysisReportPayload } from "./AnalysisReportButton";

export type HFTStrategyOutput = {
  success: boolean;
  widget?: string;
  engine?: string;
  intentClass?: string;
  intentSummary?: string;
  symbol?: string;
  benchmark?: string;
  hftSession?: HFTSessionResult;
  hftMetrics?: HFTSessionMetrics;
  engineSpec?: { hft?: HFTStrategyConfig };
  marketRoutingMode?: string;
  riskCapsApplied?: {
    maxDrawdownLimit: number;
    stopLossPercentage: number;
    trailingStop: boolean;
  };
  notice?: string;
  snapshotId?: string;
  reportUrl?: string;
  series?: { date: string; equity: number; benchmark: number }[];
  errors?: string[];
};

function fmtBps(bps: number): string {
  const sign = bps >= 0 ? "+" : "";
  return `${sign}${bps.toFixed(1)} bps`;
}

function fmtMs(ms: number): string {
  return `${ms.toFixed(0)} ms`;
}

function fmtPct(frac: number): string {
  return `${(frac * 100).toFixed(2)}%`;
}

function MetricPill({
  label,
  value,
  hint,
  warn,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  warn?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "lpft-inline-metric",
        accent ? "border-[var(--accent-muted)] bg-[var(--accent-muted)]" : "",
      ].join(" ")}
      title={hint}
    >
      <span className="lpft-inline-metric-label">{label}</span>
      <span className={["lpft-inline-metric-value", warn ? "text-[var(--danger)]" : ""].join(" ")}>
        {value}
      </span>
    </div>
  );
}

function reasonLabel(code: string): string {
  const map: Record<string, string> = {
    order_book_imbalance_bid: "Imbalance bid",
    order_book_imbalance_ask: "Imbalance ask",
    taker_market_bid: "Taker long",
    taker_market_ask: "Taker short",
    maker_limit_filled: "Maker fill",
    maker_limit_crossed: "Maker crossed",
    micro_stop_loss: "Micro stop",
    target_profit: "Target profit",
    latency_exceeded: "Latenza",
    session_timeout: "Timeout",
    finalize: "Chiusura",
  };
  return map[code] ?? code;
}

export function isHFTStrategyOutput(o: unknown): o is HFTStrategyOutput {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return (
    x.widget === "hft_strategy_v1" ||
    (x.engine === "hft-engine" && typeof x.success === "boolean")
  );
}

export function HFTStrategyWidget({
  output,
  payload,
  cacheKey,
  inline = true,
}: {
  output: HFTStrategyOutput;
  payload?: AnalysisReportPayload | null;
  cacheKey?: string;
  inline?: boolean;
}) {
  if (!output.success) {
    return (
      <div className="rounded-lg border border-[rgba(255,59,48,0.35)] bg-[rgba(255,59,48,0.06)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--danger)]">
          Compilazione HFT fallita
        </p>
        <ul className="mt-2 list-inside list-disc font-mono text-[11px] text-[var(--text-secondary)]">
          {(output.errors ?? ["Errore sconosciuto"]).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  const sym = output.symbol ?? "—";
  const session = output.hftSession;
  const hftMetrics = output.hftMetrics;
  const hft = output.engineSpec?.hft;
  const trades = session?.trades ?? [];
  const totalPnlBps = hftMetrics?.sessionPnLBps ?? session?.totalPnlBps ?? 0;
  const winRate = hftMetrics?.winRate;
  const winCount = trades.filter((t) => t.pnlBps > 0).length;

  const shell = inline ? "lpft-inline-analysis" : "space-y-3";

  return (
    <div className={shell}>
      <div className="lpft-inline-analysis-head">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">
            HFT Engine · Scalping Alpaca replay
          </p>
          <p className="mt-0.5 font-mono text-[15px] font-semibold text-[var(--text-primary)]">{sym}</p>
          <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
            HIGH_FREQUENCY_SCALPING · tick/L2
          </p>
          {output.intentSummary ? (
            <p className="mt-1.5 text-[12px] leading-snug text-[var(--text-secondary)]">
              {output.intentSummary}
            </p>
          ) : null}
        </div>
        {trades.length > 0 ? (
          <span className="lpft-report-chip shrink-0">{trades.length} scalp</span>
        ) : null}
      </div>

      {session?.halted ? (
        <div className="rounded-lg border border-[rgba(255,214,10,0.35)] bg-[rgba(255,214,10,0.08)] px-3 py-2 text-[11px] text-[var(--warning)]">
          Sessione interrotta: {session.haltReason ?? "halt"}
        </div>
      ) : null}

      <div className="lpft-inline-metric-row">
        <MetricPill
          label="PnL sessione"
          value={fmtBps(totalPnlBps)}
          hint="Somma PnL dei round-trip in basis points"
          accent={totalPnlBps >= 0}
          warn={totalPnlBps < 0}
        />
        <MetricPill
          label="Win rate"
          value={
            winRate != null
              ? `${(winRate * 100).toFixed(0)}%`
              : trades.length > 0
                ? `${((winCount / trades.length) * 100).toFixed(0)}%`
                : "—"
          }
          hint="Scalp chiusi in profitto"
        />
        {hftMetrics?.profitFactor != null ? (
          <MetricPill
            label="Profit factor"
            value={hftMetrics.profitFactor.toFixed(2)}
            hint="Somma win / |somma loss|"
          />
        ) : null}
        <MetricPill
          label="Latenza media"
          value={
            hftMetrics
              ? fmtMs(hftMetrics.avgLatencyMs)
              : session
                ? fmtMs(session.avgLatencyMs)
                : "—"
          }
          hint="Campioni osservati nel replay"
        />
        <MetricPill
          label="Tick / L2"
          value={
            hftMetrics
              ? `${hftMetrics.ticksProcessed} / ${hftMetrics.bookUpdates}`
              : session
                ? `${session.ticksProcessed} / ${session.bookUpdates}`
                : "—"
          }
          hint="Eventi processati nel replay"
        />
      </div>

      {hft ? (
        <div className="flex flex-wrap gap-2 font-mono text-[10px] text-[var(--text-tertiary)]">
          <span className="rounded border border-[var(--border-subtle)] px-2 py-0.5">
            max latency {hft.maxLatencyMs} ms
          </span>
          <span className="rounded border border-[var(--border-subtle)] px-2 py-0.5">
            imbalance ≥ {(hft.orderBookImbalanceTrigger * 100).toFixed(0)}%
          </span>
          <span className="rounded border border-[var(--border-subtle)] px-2 py-0.5">
            micro SL {hft.microStopLossBps} bps
          </span>
          <span className="rounded border border-[var(--border-subtle)] px-2 py-0.5">
            target {hft.targetProfitBps} bps
          </span>
          <span className="rounded border border-[var(--border-subtle)] px-2 py-0.5">
            spread stim. {hft.estimatedSpreadBps} bps
          </span>
          <span
            className={`rounded border px-2 py-0.5 ${
              hft.useLimitOrdersOnly
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-400"
            }`}
          >
            {hft.useLimitOrdersOnly ? "maker (limit)" : "taker (market)"}
          </span>
          {output.marketRoutingMode ? (
            <span className="rounded border border-[var(--accent-muted)] bg-[var(--accent-muted)] px-2 py-0.5 text-[var(--accent)]">
              {output.marketRoutingMode}
            </span>
          ) : null}
        </div>
      ) : null}

      {trades.length > 0 ? (
        <div className="lpft-inline-chart space-y-3">
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              Equity cumulativa (scalp)
            </p>
            <HftEquityChart
              trades={trades}
              height={160}
              color={totalPnlBps >= 0 ? "rgba(50, 215, 75, 0.88)" : "rgba(255, 69, 58, 0.88)"}
              fill={totalPnlBps >= 0 ? "rgba(50, 215, 75, 0.12)" : "rgba(255, 69, 58, 0.1)"}
            />
          </div>
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              Distribuzione scalp (bps)
            </p>
            <HFTScalpTradeBars trades={trades} />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-4 text-center text-[12px] text-[var(--text-tertiary)]">
          Nessuno scalp chiuso in questa sessione
          {session?.halted && session.haltReason
            ? ` (${session.haltReason})`
            : " — prova a ridurre orderBookImbalanceTrigger o aumenta executionTimeoutSeconds."}
        </div>
      )}

      {trades.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
          <table className="w-full min-w-[420px] text-left text-[11px]">
            <thead className="border-b border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
              <tr>
                <th className="px-2 py-1.5 font-medium">#</th>
                <th className="px-2 py-1.5 font-medium">Side</th>
                <th className="px-2 py-1.5 font-medium">PnL</th>
                <th className="px-2 py-1.5 font-medium">Ingresso</th>
                <th className="px-2 py-1.5 font-medium">Uscita</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[var(--text-secondary)]">
              {trades.slice(-8).map((t) => (
                <tr key={t.tradeIndex} className="border-b border-[var(--border-subtle)] last:border-0">
                  <td className="px-2 py-1">{t.tradeIndex}</td>
                  <td className="px-2 py-1">{t.side}</td>
                  <td
                    className={[
                      "px-2 py-1",
                      t.pnlBps >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]",
                    ].join(" ")}
                  >
                    {fmtBps(t.pnlBps)}
                  </td>
                  <td className="px-2 py-1 text-[var(--text-tertiary)]">
                    {reasonLabel(t.reasonEntry)}
                  </td>
                  <td className="px-2 py-1 text-[var(--text-tertiary)]">
                    {reasonLabel(t.reasonExit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {output.notice ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 text-[11px] leading-snug text-[var(--text-tertiary)]">
          {output.notice}
        </p>
      ) : null}

      {output.riskCapsApplied ? (
        <p className="font-mono text-[10px] text-[var(--text-tertiary)]">
          Risk cap portfolio max DD {fmtPct(output.riskCapsApplied.maxDrawdownLimit)} · micro SL{" "}
          {fmtPct(output.riskCapsApplied.stopLossPercentage)}
        </p>
      ) : null}

      {cacheKey ? (
        <SaveStrategyActions
          snapshotId={output.snapshotId}
          reportUrl={output.reportUrl}
          payload={payload ?? null}
          defaultTitle={output.intentSummary ?? sym}
          cacheKey={cacheKey}
        />
      ) : null}
    </div>
  );
}
