"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAfxStore } from "../../lib/afx-store";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ExecutionStatusBar } from "./ExecutionStatusBar";

const CONVERSATION_STORAGE_KEY = "afx-conversation-id";

function newClientChatSessionId(): string {
  return `afx-${crypto.randomUUID().replace(/-/g, "")}`;
}

function SymbolPrefill({
  onPrefill,
}: {
  onPrefill: (symbol: string) => void;
}) {
  const searchParams = useSearchParams();
  const prefillSeedRef = useRef<string | null>(null);

  useEffect(() => {
    const rawSymbol = searchParams.get("symbol") ?? "";
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol || symbol === prefillSeedRef.current) return;
    prefillSeedRef.current = symbol;
    onPrefill(symbol);
  }, [searchParams, onPrefill]);

  return null;
}

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
        "executionLogId" in p.output &&
        !(p.output as { rejected?: boolean }).rejected
      ) {
        return String((p.output as { executionLogId: string }).executionLogId);
      }
    }
  }
  return null;
}

export function FiduciaryChat() {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [clientChatId] = useState(newClientChatSessionId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatId = conversationId ?? clientChatId;

  useEffect(() => {
    useAfxStore.persist.rehydrate();
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(CONVERSATION_STORAGE_KEY)?.trim();
    if (saved && saved !== "afx-fiduciary-chat-v1") setConversationId(saved);
    else if (saved === "afx-fiduciary-chat-v1") {
      window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
    }
  }, []);

  const onSymbolPrefill = useCallback((symbol: string) => {
    setInput(`Analizza ${symbol} (setup, rischio e livelli operativi).`);
    textareaRef.current?.focus();
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: async (input, init) => {
          const res = await fetch(input, init);
          const serverConversationId = res.headers.get("x-afx-conversation-id")?.trim();
          if (serverConversationId && typeof window !== "undefined") {
            window.localStorage.setItem(CONVERSATION_STORAGE_KEY, serverConversationId);
            setConversationId(serverConversationId);
          }
          return res;
        },
        prepareSendMessagesRequest: ({ messages, body }) => {
          const bodyRecord: Record<string, unknown> = {
            ...(body ?? {}),
            messages,
            walletAddress: useAfxStore.getState().walletAddress,
          };
          if (conversationId) {
            bodyRecord.conversationId = conversationId;
          }
          return { body: bodyRecord };
        },
      }),
    [conversationId],
  );

  const { messages, sendMessage, status, stop, error } = useChat({ transport, id: chatId });
  const busy = status === "streaming" || status === "submitted";

  const activeExecutionId = useMemo(
    () => latestProposedExecutionId(messages),
    [messages],
  );

  async function submitMessage() {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    await sendMessage({ text: t });
    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submitMessage();
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitMessage();
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense fallback={null}>
        <SymbolPrefill onPrefill={onSymbolPrefill} />
      </Suspense>
      <div className="lpft-main lpft-main-chat-full min-h-0 flex-1">
        <div className="lpft-card lpft-card--chat-full flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="lpft-chat-scroll min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            <div className="lpft-chat-content space-y-8 py-6 sm:py-8">
                {messages.length === 0 && (
                  <div className="pt-8 text-center">
                    <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                      Come posso aiutarti?
                    </h2>
                    <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--text-tertiary)]">
                      Domande su mercati e rischio, backtest, strategie quantitative o esecuzione
                      intent-based. I report compaiono qui come widget nella conversazione.
                    </p>
                    <div className="mt-6 flex flex-wrap justify-center gap-2">
                      {[
                        "Spiega il drawdown in parole semplici",
                        "Backtest AAPL vs S&P, 2 anni",
                        "Strategia difensiva su SPY",
                      ].map((hint) => (
                        <button
                          key={hint}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setInput(hint);
                            textareaRef.current?.focus();
                          }}
                          className="rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] transition hover:border-[var(--accent-muted)] hover:text-[var(--text-primary)] disabled:opacity-40"
                        >
                          {hint}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((m) => (
                  <ChatMessageBubble key={m.id} message={m} />
                ))}
                {busy && messages.length > 0 && messages[messages.length - 1]?.role === "user" ? (
                  <div className="flex flex-col items-start">
                    <p className="mb-1.5 px-0.5 text-[11px] font-medium text-[var(--accent)]">AFX</p>
                    <p className="text-[13px] text-[var(--text-tertiary)]">sta rispondendo…</p>
                  </div>
                ) : null}
                {error ? (
                  <p className="text-center text-[13px] text-[var(--danger)]">{error.message}</p>
                ) : null}
                <div ref={bottomRef} />
              </div>
            </div>

            {activeExecutionId ? (
              <div className="lpft-chat-content shrink-0">
                <ExecutionStatusBar
                  executionLogId={activeExecutionId}
                  walletAddress={walletAddress}
                />
              </div>
            ) : null}

            <form
              onSubmit={onSubmit}
              className="shrink-0 border-t border-[var(--border-subtle)] pb-4 pt-2"
            >
              <div className="lpft-chat-content">
                <div className="lpft-chat-composer relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={onInputChange}
                  onKeyDown={onInputKeyDown}
                  placeholder="Chiedi qualsiasi cosa…"
                  rows={1}
                  disabled={busy}
                  className="lpft-chat-composer-input"
                />
                <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                  {busy ? (
                    <button
                      type="button"
                      onClick={() => void stop()}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-tertiary)] transition hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--text-primary)]"
                      aria-label="Interrompi"
                      title="Interrompi"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                        <rect x="4" y="4" width="8" height="8" rx="1" />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="submit"
                    disabled={!input.trim() || busy}
                    className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--text-primary)] text-[var(--bg-primary)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
                    aria-label="Invia"
                  >
                    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 3v7.5M8 3L5.5 5.5M8 3l2.5 2.5"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              </div>
            </form>
        </div>
      </div>
    </div>
  );
}
