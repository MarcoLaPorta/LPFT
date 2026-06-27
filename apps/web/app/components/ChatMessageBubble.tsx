"use client";

import type { UIMessage } from "ai";
import { getToolName, isToolUIPart } from "ai";
import { AnalysisInlineWidget } from "./AnalysisInlineWidget";
import { backtestOutputToPayload } from "./backtestReportPayload";
import { ProposeExecutionWidget, type ProposeExecutionOutput } from "./ProposeExecutionWidget";
import { HFTStrategyWidget, isHFTStrategyOutput } from "./HFTStrategyWidget";
import { QuantStrategyWidget, type QuantStrategyOutput } from "./QuantStrategyWidget";
import { hftOutputToPayload } from "./backtestReportPayload";
import { renderChatFormattedText } from "../../lib/format-chat-text";
import type { BacktestPoint } from "./BacktestWidget";

const TOOL_LABELS: Record<string, string> = {
  analyzeMarketData: "Dati di mercato",
  runStrategyBacktest: "Backtest",
  buildQuantitativeStrategy: "Strategia quantitativa",
  proposeExecution: "Proposta di esecuzione",
  executeTrade: "Esecuzione",
  executeSwap: "Swap",
};

function toolLabel(name: string) {
  return TOOL_LABELS[name] ?? name;
}

function isBacktestOutput(
  o: unknown,
): o is {
  symbol: string;
  benchmark: string;
  series: BacktestPoint[];
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  benchmarkMetrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  projections?: unknown;
  snapshotId?: string;
  reportUrl?: string;
  tradeCount?: number;
} {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return (
    typeof x.symbol === "string" &&
    typeof x.benchmark === "string" &&
    Array.isArray(x.series) &&
    x.series.length > 0
  );
}

function isQuantStrategyOutput(o: unknown): o is QuantStrategyOutput {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return typeof x.success === "boolean" && (x.widget === "quant_strategy_v1" || "errors" in x);
}

function isProposeOutput(o: unknown): o is ProposeExecutionOutput {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return typeof x.executionLogId === "string" || x.rejected === true;
}

function ToolStatus({ label, state }: { label: string; state: string }) {
  if (state === "output-available") return null;
  if (state === "output-error") {
    return <p className="text-[12px] text-[var(--danger)]">{label} — errore</p>;
  }
  return (
    <p className="text-[12px] text-[var(--text-tertiary)]">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <span className="ml-1.5 opacity-60">···</span>
    </p>
  );
}

export function ChatMessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <article className={`flex w-full flex-col ${isUser ? "items-end" : "items-start"}`}>
      <header
        className={[
          "mb-1.5 px-0.5 text-[11px] font-medium tracking-wide",
          isUser ? "text-[var(--text-tertiary)]" : "text-[var(--accent)]",
        ].join(" ")}
      >
        {isUser ? "Tu" : "AFX"}
      </header>

      <div
        className={[
          "w-full space-y-3 text-[14px] leading-[1.55]",
          isUser
            ? "max-w-[min(100%,36rem)] rounded-2xl rounded-br-md bg-[rgba(124,58,237,0.12)] px-4 py-2.5 text-[var(--text-primary)]"
            : "max-w-[min(100%,52rem)] text-[var(--text-primary)]",
        ].join(" ")}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text" && part.text.trim()) {
            return (
              <div key={i} className="whitespace-pre-wrap">
                {!isUser ? renderChatFormattedText(part.text) : part.text}
              </div>
            );
          }
          if (isToolUIPart(part)) {
            const name = getToolName(part);
            const label = toolLabel(name);

            if (
              name === "buildQuantitativeStrategy" &&
              part.state === "output-available" &&
              isHFTStrategyOutput(part.output)
            ) {
              const payload = hftOutputToPayload(
                "buildQuantitativeStrategy",
                part.output as unknown as Record<string, unknown>,
              );
              return (
                <div key={part.toolCallId} className="space-y-2">
                  <p className="text-[11px] text-[var(--text-tertiary)]">{label}</p>
                  <HFTStrategyWidget
                    output={part.output}
                    payload={payload}
                    cacheKey={part.toolCallId}
                  />
                </div>
              );
            }

            if (
              name === "buildQuantitativeStrategy" &&
              part.state === "output-available" &&
              isQuantStrategyOutput(part.output)
            ) {
              if (!part.output.success) {
                return (
                  <div key={part.toolCallId} className="space-y-2">
                    <p className="text-[11px] text-[var(--text-tertiary)]">{label}</p>
                    <QuantStrategyWidget output={part.output} />
                  </div>
                );
              }
              const payload = backtestOutputToPayload(
                "buildQuantitativeStrategy",
                part.output as unknown as Record<string, unknown>,
              );
              const series = part.output.series ?? [];
              if (series.length >= 2 && payload) {
                return (
                  <div key={part.toolCallId} className="space-y-2">
                    <AnalysisInlineWidget
                      source="buildQuantitativeStrategy"
                      symbol={part.output.symbol ?? "—"}
                      benchmark={part.output.benchmark}
                      intentSummary={part.output.intentSummary}
                      intentClass={part.output.intentClass}
                      series={series}
                      metrics={part.output.metrics}
                      benchmarkMetrics={part.output.benchmarkMetrics}
                      tradeCount={part.output.tradeCount}
                      snapshotId={part.output.snapshotId}
                      reportUrl={part.output.reportUrl}
                      payload={payload}
                      cacheKey={part.toolCallId}
                    />
                  </div>
                );
              }
              return (
                <div key={part.toolCallId} className="space-y-2">
                  <p className="text-[11px] text-[var(--text-tertiary)]">{label}</p>
                  <QuantStrategyWidget output={part.output} />
                </div>
              );
            }

            if (
              name === "runStrategyBacktest" &&
              part.state === "output-available" &&
              isBacktestOutput(part.output)
            ) {
              const o = part.output as Record<string, unknown>;
              const payload = backtestOutputToPayload("runStrategyBacktest", o);
              if (payload) {
                return (
                  <div key={part.toolCallId} className="space-y-2">
                    <AnalysisInlineWidget
                      source="runStrategyBacktest"
                      symbol={part.output.symbol}
                      benchmark={part.output.benchmark}
                      series={part.output.series}
                      metrics={part.output.metrics}
                      benchmarkMetrics={part.output.benchmarkMetrics}
                      tradeCount={o.tradeCount as number | undefined}
                      snapshotId={o.snapshotId as string | undefined}
                      reportUrl={o.reportUrl as string | undefined}
                      payload={payload}
                      cacheKey={part.toolCallId}
                    />
                  </div>
                );
              }
            }

            if (
              name === "proposeExecution" &&
              part.state === "output-available" &&
              isProposeOutput(part.output)
            ) {
              return (
                <div key={part.toolCallId} className="border-l-2 border-[var(--success)]/40 pl-3">
                  <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">{label}</p>
                  <ProposeExecutionWidget output={part.output} />
                </div>
              );
            }
            if (
              (name === "executeTrade" || name === "executeSwap") &&
              part.state === "output-available"
            ) {
              const o = part.output as Record<string, unknown>;
              return (
                <div key={part.toolCallId} className="border-l-2 border-[var(--success)]/30 pl-3 text-[13px]">
                  <p className="text-[var(--success)]">Esecuzione registrata</p>
                  <p className="mt-1 break-all font-mono text-[11px] text-[var(--text-tertiary)]">
                    {String(o.transactionHash ?? "")}
                  </p>
                </div>
              );
            }
            if (name === "analyzeMarketData" && part.state === "output-available") {
              const o = part.output as Record<string, unknown>;
              return (
                <div key={part.toolCallId} className="border-l-2 border-[var(--border-subtle)] pl-3 text-[13px]">
                  <p className="text-[11px] text-[var(--text-tertiary)]">{label}</p>
                  <p className="mt-1 text-[var(--text-secondary)]">
                    {String(o.ticker)} · close {String(o.lastClose)} · {String(o.barCount)} barre
                    {o.suggestedRouting ? ` · ${String(o.suggestedRouting)}` : ""}
                  </p>
                </div>
              );
            }
            if (part.state === "output-error") {
              return (
                <p key={part.toolCallId} className="text-[12px] text-[var(--danger)]">
                  {label}: {part.errorText}
                </p>
              );
            }
            return <ToolStatus key={part.toolCallId} label={label} state={part.state} />;
          }
          return null;
        })}
      </div>
    </article>
  );
}
