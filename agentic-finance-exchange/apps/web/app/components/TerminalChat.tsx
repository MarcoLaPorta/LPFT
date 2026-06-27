"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import { useMemo, useRef, useState } from "react";
import { useAfxStore } from "@/lib/afx-store";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ExecutionStatusBar } from "./ExecutionStatusBar";

function latestProposedExecutionId(messages: UIMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    for (const p of m.parts) {
      if (
        isToolUIPart(p) &&
        getToolName(p) === "proposeExecution" &&
        p.state === "output-available" &&
        p.output &&
        typeof p.output === "object" &&
        "executionLogId" in p.output
      ) {
        return String((p.output as { executionLogId: string }).executionLogId);
      }
    }
  }
  return null;
}

export function TerminalChat() {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages, body, id }) => ({
          body: {
            ...body,
            id,
            messages,
            walletAddress: useAfxStore.getState().walletAddress,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });

  const activeExecutionId = useMemo(
    () => latestProposedExecutionId(messages),
    [messages],
  );

  const busy = status === "streaming" || status === "submitted";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    await sendMessage({ text: t });
    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-6">
        {messages.length === 0 && (
          <div className="mx-auto max-w-2xl rounded-lg border border-dashed border-white/10 bg-zinc-950/50 p-6 text-center text-sm text-zinc-500">
            <p className="font-mono text-xs uppercase tracking-widest text-violet-400/80">
              AFX Quant Terminal
            </p>
            <p className="mt-3 text-zinc-400">
              Chiedi un backtest (es. strategia drawdown-to-stable su AAPL 2y vs
              S&P) o usa i tool automatici del modello.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <ChatMessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      <ExecutionStatusBar
        executionLogId={activeExecutionId}
        walletAddress={walletAddress}
      />

      <form
        onSubmit={onSubmit}
        className="border-t border-white/10 bg-black/80 p-3 backdrop-blur-md sm:p-4"
      >
        <div className="mx-auto flex max-w-5xl gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Intento di trading o domanda quant…"
            rows={2}
            disabled={busy}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 font-sans text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => void stop()}
              className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 font-mono text-xs uppercase tracking-wide text-red-300 hover:bg-red-500/20"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="shrink-0 rounded-lg bg-violet-600 px-5 py-2 font-mono text-xs font-medium uppercase tracking-wide text-white shadow-lg shadow-violet-900/30 hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Invia
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
