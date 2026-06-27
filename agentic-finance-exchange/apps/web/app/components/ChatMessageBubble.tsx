"use client";

import type { UIMessage } from "ai";
import { getToolName, isToolUIPart } from "ai";
import { BacktestWidget, type BacktestPoint } from "./BacktestWidget";

function isBacktestOutput(
  o: unknown,
): o is {
  symbol: string;
  benchmark: string;
  series: BacktestPoint[];
  metrics?: { cagr: number; sharpe: number; maxDrawdown: number };
  benchmarkMetrics?: { cagr: number; sharpe: number; maxDrawdown: number };
} {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return (
    typeof x.symbol === "string" &&
    typeof x.benchmark === "string" &&
    Array.isArray(x.series) &&
    x.series.length > 0 &&
    typeof (x.series[0] as { date?: unknown }).date === "string"
  );
}

function isProposeOutput(
  o: unknown,
): o is { executionLogId: string; idempotencyKey: string; status: string } {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return typeof x.executionLogId === "string";
}

export function ChatMessageBubble({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        className={`max-w-[min(100%,52rem)] space-y-2 rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-violet-600/20 text-zinc-100 ring-1 ring-violet-500/30"
            : "bg-zinc-900/90 text-zinc-200 ring-1 ring-white/10"
        }`}
      >
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return (
              <p key={i} className="whitespace-pre-wrap font-sans">
                {part.text}
              </p>
            );
          }
          if (isToolUIPart(part)) {
            const name = getToolName(part);
            if (
              name === "runStrategyBacktest" &&
              part.state === "output-available" &&
              isBacktestOutput(part.output)
            ) {
              return (
                <BacktestWidget
                  key={part.toolCallId}
                  symbol={part.output.symbol}
                  benchmarkSymbol={part.output.benchmark}
                  series={part.output.series}
                  metrics={part.output.metrics}
                  benchmarkMetrics={part.output.benchmarkMetrics}
                />
              );
            }
            if (
              name === "proposeExecution" &&
              part.state === "output-available" &&
              isProposeOutput(part.output)
            ) {
              return (
                <div
                  key={part.toolCallId}
                  className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 font-mono text-xs text-emerald-100/90"
                >
                  <p className="text-[10px] uppercase tracking-wide text-emerald-400/80">
                    ExecutionLog (DRAFT)
                  </p>
                  <p className="mt-1 break-all text-emerald-100/95">
                    {part.output.executionLogId}
                  </p>
                </div>
              );
            }
            if (name === "executeSwap" && part.state === "output-available") {
              const o = part.output as Record<string, unknown>;
              return (
                <div
                  key={part.toolCallId}
                  className="rounded-lg border border-sky-500/25 bg-sky-500/5 p-3 font-mono text-xs text-sky-100/90"
                >
                  <p className="text-[10px] uppercase tracking-wide text-sky-400/80">
                    Submitted
                  </p>
                  <p className="mt-1 break-all">{String(o.transactionHash ?? "")}</p>
                </div>
              );
            }
            if (part.state === "output-available") {
              return (
                <pre
                  key={part.toolCallId}
                  className="max-h-40 overflow-auto rounded bg-black/50 p-2 font-mono text-[11px] text-zinc-400"
                >
                  {JSON.stringify(part.output, null, 2)}
                </pre>
              );
            }
            if (part.state === "output-error") {
              return (
                <p key={part.toolCallId} className="text-xs text-red-400/90">
                  Tool {name}: {part.errorText}
                </p>
              );
            }
            return (
              <p key={part.toolCallId} className="text-xs text-zinc-500">
                Tool {name}: {part.state.replace(/-/g, " ")}
              </p>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
