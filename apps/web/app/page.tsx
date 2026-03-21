"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  artifactUrl,
  type CapabilityReport,
  type RunOut,
  type StrategySpec,
  type ValidationSummary,
} from "../lib/api";
import { EquityChart, parseEquityCsv } from "./components/EquityChart";
import type { LineData } from "lightweight-charts";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_SYMBOL = "AAPL";
const DEFAULT_TIMEFRAME = "1d";
const DEFAULT_VIEW_RANGE = "1y";
const BACKTEST_DATA_PERIOD = "5y";

/** Token che non sono ticker (allineato alla logica server assistant). */
const TICKER_BLACKLIST = new Set(
  "RSI EMA SMA MACD OHLCV ETF ETFS USA USD SP500 THE AND FOR NASDAQ".split(/\s+/)
);

/** Estrae un ticker dall’ultimo testo utente (es. MSFT, BTC-USD). */
function extractTickerFromText(text: string): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  const re = /\$?([A-Z]{2,6}(?:-[A-Z]{3,4})?)\b/gi;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    const sym = m[1].toUpperCase();
    if (!TICKER_BLACKLIST.has(sym)) found.push(sym);
  }
  if (found.length > 0) return found[found.length - 1];
  const low = trimmed.toLowerCase();
  if (/\bbitcoin\b|\bbtc\b/i.test(low)) return "BTC-USD";
  if (/\bethereum\b|\beth\b/i.test(low)) return "ETH-USD";
  return undefined;
}

/**
 * Simbolo da inviare all’API: priorità = messaggio corrente → spec strategia → params ultimo run → default.
 * Così cambiando ticker in chat i Results non restano bloccati su AAPL.
 */
function resolveAssistantStreamSymbol(
  latestUserPrompt: string,
  historyMessages: ChatMessage[],
  currentContext:
    | Extract<ChatMessage, { role: "assistant" }>
    | undefined
): string {
  const fromPrompt = extractTickerFromText(latestUserPrompt);
  if (fromPrompt) return fromPrompt;
  const recentUsers = historyMessages.filter((m) => m.role === "user").slice(-3);
  for (let i = recentUsers.length - 1; i >= 0; i--) {
    const t = extractTickerFromText(recentUsers[i].content);
    if (t) return t;
  }
  const specSym = currentContext?.spec?.universe?.symbols?.[0];
  if (specSym) return specSym;
  return currentContext?.params?.symbol ?? DEFAULT_SYMBOL;
}

/** Estrae la frase corrente dal ragionamento (ultima frase o testo in corso). */
function currentReasoningPhrase(reasoning: string): string {
  const normalized = reasoning
    .replace(/---JSON---/gi, " ")
    .replace(/---+/g, " ")
    .replace(/```/g, " ")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Reviewing the request.";
  const lastEnd = Math.max(
    normalized.lastIndexOf(". "),
    normalized.lastIndexOf("! "),
    normalized.lastIndexOf("? ")
  );
  const candidate = (lastEnd === -1 ? normalized : normalized.slice(lastEnd + 1)).trim() || normalized;
  const cleaned = candidate
    .replace(/^[-–—.:;|/\\]+/, "")
    .replace(/[-–—.:;|/\\]+$/, "")
    .trim();
  if (!cleaned || /^[-–—.:;|/\\]+$/.test(cleaned)) return "Reviewing the request.";
  return cleaned;
}

type CodeTokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "function"
  | "decorator";

function tokenizePythonLine(line: string): { text: string; kind: CodeTokenKind }[] {
  const tokens: { text: string; kind: CodeTokenKind }[] = [];
  const pattern =
    /(#.*$)|(@[A-Za-z_][A-Za-z0-9_]*)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(def|return|if|elif|else|for|while|in|import|from|as|True|False|None|and|or|not|class|try|except|with|yield|break|continue|pass)\b|\b(\d+(?:\.\d+)?)\b/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const [fullMatch, comment, decorator, stringToken, keywordToken, numberToken] = match;
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), kind: "plain" });
    }
    let kind: CodeTokenKind = "plain";
    if (comment) kind = "comment";
    else if (decorator) kind = "decorator";
    else if (stringToken) kind = "string";
    else if (keywordToken) kind = "keyword";
    else if (numberToken) kind = "number";
    tokens.push({ text: fullMatch, kind });
    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), kind: "plain" });
  }

  const out: { text: string; kind: CodeTokenKind }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i];
    out.push(current);
    if (
      current.kind === "keyword" &&
      (current.text === "def" || current.text === "class") &&
      i + 2 < tokens.length &&
      tokens[i + 1].kind === "plain"
    ) {
      const fnMatch = tokens[i + 2].text.match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (fnMatch) {
        const name = fnMatch[0];
        out.push({ text: tokens[i + 1].text, kind: "plain" });
        out.push({ text: name, kind: "function" });
        const rest = tokens[i + 2].text.slice(name.length);
        if (rest) out.push({ text: rest, kind: tokens[i + 2].kind });
        i += 2;
      }
    }
  }
  return out;
}

function renderPythonCode(code: string) {
  const lines = code.split("\n");
  return lines.map((line, lineIndex) => {
    const tokens = tokenizePythonLine(line);
    return (
      <span key={`line-${lineIndex}`}>
        {tokens.map((token, tokenIndex) => (
          <span
            key={`token-${lineIndex}-${tokenIndex}`}
            className={token.kind === "plain" ? undefined : `lpft-code-token-${token.kind}`}
          >
            {token.text}
          </span>
        ))}
        {lineIndex < lines.length - 1 ? "\n" : null}
      </span>
    );
  });
}

function renderAssistantText(text: string) {
  const lines = text.split("\n");
  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={`assistant-line-${lineIndex}`}>
        {parts.map((part, partIndex) => {
          const boldMatch = part.match(/^\*\*([^*]+)\*\*$/);
          if (boldMatch) {
            return (
              <strong key={`assistant-part-${lineIndex}-${partIndex}`} className="font-semibold text-[var(--text-primary)]">
                {boldMatch[1]}
              </strong>
            );
          }
          return <span key={`assistant-part-${lineIndex}-${partIndex}`}>{part}</span>;
        })}
        {lineIndex < lines.length - 1 ? "\n" : null}
      </span>
    );
  });
}

function formatRunStatus(status: "idle" | "pending" | "running" | "completed" | "failed" | undefined) {
  if (status === "completed") return "Backtest completato";
  if (status === "failed") return "Backtest non riuscito";
  if (status === "pending") return "In coda per il backtest";
  if (status === "running") return "Backtest in esecuzione";
  return "Pronto per il backtest";
}

function renderDataSources(
  sources:
    | Array<{
        provider_requested?: string;
        provider_used?: string;
        asset_class?: string;
        canonical_symbol?: string;
        requested_symbol?: string;
        freshness_status?: string;
        coverage_status?: string;
        status?: string;
        rows?: number;
        warnings?: string[];
        fallback_used?: boolean;
      }>
    | undefined
) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-3 space-y-2">
      {sources.map((source, index) => (
        <div
          key={`${source.canonical_symbol ?? source.requested_symbol ?? "source"}-${index}`}
          className="rounded-[16px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] px-3 py-2.5"
        >
          <p className="text-[12px] text-[var(--text-primary)]">
            {(source.canonical_symbol ?? source.requested_symbol ?? "Dataset") +
              (source.provider_used ? ` · ${source.provider_used}` : "")}
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
            {(source.asset_class ?? "unknown") +
              (source.status ? ` · ${source.status}` : "") +
              (source.freshness_status ? ` · freshness: ${source.freshness_status}` : "") +
              (source.coverage_status ? ` · coverage: ${source.coverage_status}` : "") +
              (typeof source.rows === "number" ? ` · rows: ${source.rows}` : "")}
          </p>
          {source.fallback_used && (
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Fallback provider used.</p>
          )}
          {source.warnings && source.warnings.length > 0 && (
            <div className="mt-1.5 space-y-1">
              {source.warnings.map((warning, warningIndex) => (
                <p key={`${warning}-${warningIndex}`} className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function parseTradesCsv(csvText: string): {
  entry_time: number;
  exit_time: number;
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  pnl: number;
}[] {
  const t = csvText.trim();
  if (!t) return [];
  const lines = t.split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name);
  const iEntryTime = idx("entry_time");
  const iExitTime = idx("exit_time");
  const iEntryPrice = idx("entry_price");
  const iExitPrice = idx("exit_price");
  const iPnlPct = idx("pnl_pct");
  const iPnl = idx("pnl");

  const parseTimeSec = (raw: string) => {
    const s = raw.trim();
    if (!s) return 0;
    const d = new Date(s);
    const ms = d.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  };

  const out: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim());
    const entry_time = parseTimeSec(parts[iEntryTime] ?? "");
    const exit_time = parseTimeSec(parts[iExitTime] ?? "");
    if (!entry_time || !exit_time) continue;
    out.push({
      entry_time,
      exit_time,
      entry_price: parseFloat(parts[iEntryPrice] ?? "0") || 0,
      exit_price: parseFloat(parts[iExitPrice] ?? "0") || 0,
      pnl_pct: parseFloat(parts[iPnlPct] ?? "0") || 0,
      pnl: parseFloat(parts[iPnl] ?? "0") || 0,
    });
  }
  return out;
}

function MetricsTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full text-[12px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-[var(--border-subtle)] last:border-b-0">
              <td className="px-3 py-2 text-[var(--text-tertiary)] w-[44%]">{k}</td>
              <td className="px-3 py-2 text-[var(--text-primary)] font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatParameterLabel(label: string): string {
  return label
    .split(" · ")
    .map((part) => {
      if (/^\d+$/.test(part)) return `[${part}]`;
      return part.replace(/_/g, " ");
    })
    .join(" / ");
}

function ParameterTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full table-fixed text-[12px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-[var(--border-subtle)] last:border-b-0 align-top">
              <td className="w-[42%] px-3 py-2 text-[var(--text-tertiary)] break-words">
                {formatParameterLabel(k)}
              </td>
              <td className="px-3 py-2 text-[var(--text-primary)] font-medium whitespace-pre-wrap break-words">
                {v}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildParameterRows(
  strategySpec: StrategySpec | null,
  runParams: { symbol?: string; period?: string; timeframe?: string; viewRange?: string } | null,
  run: RunOut | null
): [string, string][] {
  const source = {
    symbol: runParams?.symbol ?? run?.symbol ?? DEFAULT_SYMBOL,
    backtest_period: runParams?.period ?? run?.period ?? BACKTEST_DATA_PERIOD,
    view_range: runParams?.viewRange ?? DEFAULT_VIEW_RANGE,
    timeframe: runParams?.timeframe ?? run?.timeframe ?? DEFAULT_TIMEFRAME,
    strategy_spec: strategySpec,
  };

  const rows: [string, string][] = [];

  const flatten = (value: unknown, path: string[] = []) => {
    if (value == null) {
      rows.push([path.join(" · ") || "value", "—"]);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        rows.push([path.join(" · "), "[]"]);
        return;
      }
      const primitiveArray = value.every(
        (item) =>
          item == null ||
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean"
      );
      if (primitiveArray) {
        rows.push([path.join(" · "), value.map((item) => String(item)).join(", ")]);
        return;
      }
      value.forEach((item, idx) => flatten(item, [...path, String(idx)]));
      return;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length === 0) {
        rows.push([path.join(" · "), "{}"]);
        return;
      }
      entries.forEach(([k, v]) => flatten(v, [...path, k]));
      return;
    }
    rows.push([path.join(" · "), String(value)]);
  };

  flatten(source);
  return rows;
}

function TradesTable({
  trades,
}: {
  trades: {
    entry_time: number;
    exit_time: number;
    entry_price: number;
    exit_price: number;
    pnl_pct: number;
    pnl: number;
  }[];
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
      <table className="w-full text-[11px]">
        <thead className="bg-[rgba(255,255,255,0.03)]">
          <tr className="text-[var(--text-tertiary)]">
            <th className="px-3 py-2 text-left font-medium">Entry</th>
            <th className="px-3 py-2 text-left font-medium">Exit</th>
            <th className="px-3 py-2 text-right font-medium">PnL</th>
            <th className="px-3 py-2 text-right font-medium">PnL%</th>
          </tr>
        </thead>
        <tbody>
          {trades.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-3 text-[var(--text-secondary)]">
                Nessun trade nel periodo.
              </td>
            </tr>
          ) : (
            trades.map((t, i) => (
              <tr key={i} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2 text-[var(--text-secondary)] font-mono">
                  {new Date(t.entry_time * 1000).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-[var(--text-secondary)] font-mono">
                  {new Date(t.exit_time * 1000).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-right text-[var(--text-primary)] font-medium">
                  {t.pnl.toFixed(2)}
                </td>
                <td
                  className={[
                    "px-3 py-2 text-right font-medium",
                    t.pnl_pct > 0
                      ? "text-[rgb(21,128,61)]"
                      : t.pnl_pct < 0
                        ? "text-[rgb(185,28,28)]"
                        : "text-[var(--text-primary)]",
                  ].join(" ")}
                >
                  {(t.pnl_pct * 100).toFixed(2)}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function HomePage() {
  /** false = chat a schermo intero; true = colonna backtest visibile (dopo avvio run in sessione). */
  const [splitLayout, setSplitLayout] = useState(false);

  useEffect(() => {
    const onBacktestRun = () => setSplitLayout(true);
    window.addEventListener("lpft-backtest-run", onBacktestRun as EventListener);
    return () => window.removeEventListener("lpft-backtest-run", onBacktestRun as EventListener);
  }, []);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-[var(--bg-primary)]">
      <header className="shrink-0 h-12 flex items-center px-6 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[rgba(255,255,255,0.06)] border border-[var(--border-subtle)] flex items-center justify-center">
            <span className="text-[var(--text-primary)] font-semibold text-[13px]">L</span>
          </div>
          <span className="text-[14px] font-semibold text-[var(--text-primary)] tracking-tight">
            LPFT
          </span>
        </div>
      </header>

      <main
        className={[
          "lpft-main flex-1 min-h-0 overflow-hidden",
          splitLayout ? "" : "lpft-main-chat-full",
        ].join(" ")}
      >
        <div className="lpft-card lpft-col-left">
          <ChatColumn splitLayout={splitLayout} />
        </div>
        <div className="lpft-card lpft-col-right">
          <BacktestColumn />
        </div>
      </main>
    </div>
  );
}

type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      reasoning: string;
      code: string;
      runId?: number | null;
      strategyFlow?: boolean;
      streaming?: boolean;
      backtestStatus?: "idle" | "pending" | "running" | "completed" | "failed";
      spec?: StrategySpec | null;
      params?: { symbol?: string; period?: string; timeframe?: string; viewRange?: string } | null;
      clarification?: { question: string; options: string[]; summary?: string[]; missing?: string[] } | null;
      capability?: CapabilityReport | null;
      validation?: ValidationSummary | null;
      unsupported?: {
        detail: string;
        missing_requirements: string[];
        conversion_suggestions: string[];
        warnings: string[];
      } | null;
    };

function ChatColumn({ splitLayout }: { splitLayout: boolean }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ name: string; text: string }[]>([]);
  const [fullscreenCode, setFullscreenCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const handleGenerate = async (overridePrompt?: string) => {
    const basePrompt = overridePrompt ?? input.trim();
    if (!basePrompt.trim() && attachments.length === 0) return;
    autoScrollRef.current = true;
    setError(null);
    setLoading(true);
    const currentContext = [...messages]
      .reverse()
      .find((msg): msg is Extract<ChatMessage, { role: "assistant" }> => msg.role === "assistant" && (!!msg.code || !!msg.spec || !!msg.runId));
    const userPrompt = [
      basePrompt.trim(),
      ...(attachments.length > 0
        ? [
            "",
            "Allegati:",
            ...attachments.map(
              (a) =>
                `--- FILE: ${a.name} ---\n${a.text}\n--- END FILE: ${a.name} ---`
            ),
          ]
        : []),
    ].join("\n");
    const transcript = [
      ...messages.map((msg) =>
        msg.role === "user"
          ? { role: "user" as const, content: msg.content }
          : {
              role: "assistant" as const,
              content: [msg.content, msg.reasoning === "Reasoning complete" ? "" : msg.reasoning, msg.code ? "Generated code available." : ""]
                .filter(Boolean)
                .join("\n"),
            }
      ),
      { role: "user" as const, content: userPrompt },
    ];

    setMessages((prev) => [...prev, { role: "user", content: basePrompt.trim() }]);
    if (!overridePrompt) {
      setInput("");
      setAttachments([]);
    }
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: "",
        reasoning: "",
        code: "",
        runId: null,
        strategyFlow: false,
        streaming: true,
        backtestStatus: "idle",
        spec: null,
        params: null,
        clarification: null,
        capability: null,
        validation: null,
        unsupported: null,
      },
    ]);
    const streamSymbol = resolveAssistantStreamSymbol(basePrompt.trim(), messages, currentContext);

    try {
      await api.assistant.stream(
        {
          messages: transcript,
          current_run_id: currentContext?.runId ?? null,
          current_code: currentContext?.code ?? null,
          current_spec: currentContext?.spec ?? null,
          symbol: streamSymbol,
          period:
            currentContext?.params?.period ??
            currentContext?.spec?.data?.history_period ??
            BACKTEST_DATA_PERIOD,
          timeframe:
            currentContext?.params?.timeframe ??
            currentContext?.spec?.universe?.timeframe ??
            DEFAULT_TIMEFRAME,
        },
        {
        onAssistantChunk(chunk) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              next[next.length - 1] = { ...last, content: last.content + chunk };
            }
            return next;
          });
        },
        onReasoningChunk(chunk) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              next[next.length - 1] = { ...last, reasoning: last.reasoning + chunk, strategyFlow: true };
            }
            return next;
          });
        },
        onSpec(spec) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              next[next.length - 1] = {
                ...last,
                reasoning: "Reasoning complete",
                spec: spec as StrategySpec,
                strategyFlow: true,
              };
            }
            return next;
          });
        },
        onCode(code) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, code, strategyFlow: true };
            }
            return next;
          });
        },
        onCapability(payload) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                capability: payload,
              };
            }
            return next;
          });
        },
        onValidation(payload) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                validation: payload,
              };
            }
            return next;
          });
        },
        onUnsupportedStrategy(payload) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                unsupported: payload,
                strategyFlow: false,
              };
            }
            return next;
          });
        },
        onClarification(payload) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                clarification: payload,
              };
            }
            return next;
          });
        },
        onRun(payload) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = {
                ...last,
                code: payload.code,
                runId: payload.run_id,
                strategyFlow: true,
                backtestStatus: "pending",
                spec: payload.spec,
                params: {
                  ...payload.params,
                  viewRange: DEFAULT_VIEW_RANGE,
                },
                clarification: null,
              };
            }
            return next;
          });
          window.dispatchEvent(
            new CustomEvent("lpft-backtest-run", {
              detail: {
                runId: payload.run_id,
                code: payload.code,
                spec: payload.spec,
                params: {
                  ...payload.params,
                  viewRange: DEFAULT_VIEW_RANGE,
                },
              },
            })
          );
        },
        onRunStatus(payload) {
          setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              const msg = next[i];
              if (msg?.role === "assistant" && msg.runId === payload.run_id) {
                next[i] = {
                  ...msg,
                  backtestStatus: payload.status,
                };
                break;
              }
            }
            return next;
          });
        },
        onDone() {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant" && last.streaming) {
              next[next.length - 1] = { ...last, streaming: false };
            }
            return next;
          });
          setLoading(false);
        },
        onError(detail) {
          setError(detail);
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, streaming: false };
              return next;
            }
            return prev.slice(0, -1);
          });
          setLoading(false);
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore generazione");
      setMessages((prev) => prev.slice(0, -1));
      setLoading(false);
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const next: { name: string; text: string }[] = [];
    for (const f of picked) {
      // solo testo: se non leggibile come testo, saltiamo
      try {
        const text = await f.text();
        next.push({ name: f.name, text: text.slice(0, 200_000) });
      } catch {
        // ignore
      }
    }
    setAttachments((prev) => [...prev, ...next].slice(0, 5));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const saveStrategy = async (msg: Extract<ChatMessage, { role: "assistant" }>) => {
    if (!msg.code) return;
    setSavingCode(msg.code);
    setSaveNotice(null);
    try {
      const res = await fetch("/api/save-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: msg.code,
          reasoning: msg.reasoning,
          spec: msg.spec ?? null,
          params: msg.params ?? null,
        }),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(text || `Errore ${res.status}`);
      }
      const out = JSON.parse(text) as { folder: string };
      setSaveNotice(`Saved in ${out.folder}`);
    } catch (e) {
      setSaveNotice(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingCode(null);
    }
  };

  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoScrollRef.current) return;
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < 80;
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const nextHeight = Math.min(Math.max(el.scrollHeight, 84), 188);
    el.style.height = `${nextHeight}px`;
  }, [input]);

  useEffect(() => {
    const handler = (e: CustomEvent<{ runId?: number; status: string }>) => {
      setMessages((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          const msg = next[i];
          if (
            msg?.role === "assistant" &&
            msg.runId != null &&
            (e.detail.runId == null || msg.runId === e.detail.runId)
          ) {
            next[i] = {
              ...msg,
              backtestStatus:
                e.detail.status === "completed"
                  ? "completed"
                  : e.detail.status === "failed"
                    ? "failed"
                    : e.detail.status === "pending"
                      ? "pending"
                      : "running",
            };
            break;
          }
        }
        return next;
      });
    };
    window.addEventListener("lpft-backtest-status", handler as EventListener);
    return () => window.removeEventListener("lpft-backtest-status", handler as EventListener);
  }, []);

  return (
    <>
      <div
        ref={chatScrollRef}
        onScroll={handleChatScroll}
        className="flex-1 overflow-y-auto scrollbar-thin"
      >
        <div
          className={[
            "mx-auto px-4 py-6 space-y-8",
            splitLayout ? "max-w-2xl" : "max-w-3xl w-full",
          ].join(" ")}
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[240px] text-center px-4">
              <p className="text-[14px] text-[var(--text-secondary)]">
                Ask about markets, indicators, strategies, results, or trading code.
              </p>
              <p className="text-[12px] text-[var(--text-tertiary)] mt-1.5">
                Example: Explain RSI divergence, improve my AAPL strategy, or debug this backtest.
              </p>
            </div>
          )}

          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[82%] rounded-[22px] px-4 py-3 bg-[rgba(255,255,255,0.05)] border border-[var(--border-subtle)] text-[13px] text-[var(--text-primary)] leading-relaxed shadow-[0_1px_0_rgba(255,255,255,0.02)]">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={i} className="space-y-4">
                {(msg.content || (msg.streaming && !msg.reasoning && !msg.code)) && (
                  <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.025)] px-4 py-3.5">
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">
                      {renderAssistantText(msg.content || "Thinking...")}
                    </p>
                  </div>
                )}
                {msg.capability && (
                  <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.025)] px-4 py-3.5">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
                      Capability
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                      {msg.capability.summary}
                    </p>
                    <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
                      {`Asset: ${msg.capability.asset_class} · Provider: ${msg.capability.provider_plan} · Policy: ${msg.capability.quality_policy}`}
                    </p>
                    {msg.capability.warnings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.capability.warnings.map((warning, warningIndex) => (
                          <p key={`${warning}-${warningIndex}`} className="text-[12px] text-[var(--text-tertiary)] leading-relaxed">
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {msg.validation && (
                  <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.025)] px-4 py-3.5">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
                      Validation
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                      {msg.validation.summary}
                    </p>
                    {renderDataSources(msg.validation.data_sources)}
                    {msg.validation.warnings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.validation.warnings.map((warning, warningIndex) => (
                          <p key={`${warning}-${warningIndex}`} className="text-[12px] text-[var(--text-tertiary)] leading-relaxed">
                            {warning}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {msg.unsupported && (
                  <div className="rounded-[20px] border border-[rgba(185,28,28,0.25)] bg-[rgba(120,15,15,0.12)] px-4 py-3.5">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
                      Unsupported Strategy
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                      {msg.unsupported.detail}
                    </p>
                    {msg.unsupported.missing_requirements.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.unsupported.missing_requirements.map((item, itemIndex) => (
                          <p key={`${item}-${itemIndex}`} className="text-[12px] text-[var(--text-tertiary)] leading-relaxed">
                            {item}
                          </p>
                        ))}
                      </div>
                    )}
                    {msg.unsupported.conversion_suggestions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {msg.unsupported.conversion_suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => handleGenerate(suggestion)}
                            disabled={loading}
                            className="rounded-[999px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {msg.clarification && (
                  <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.025)] px-4 py-3.5">
                    {msg.clarification.summary && msg.clarification.summary.length > 0 && (
                      <div className="mb-3 rounded-[16px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.03)] px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
                          Strategia In Definizione
                        </p>
                        <div className="space-y-1">
                          {msg.clarification.summary.map((line) => (
                            <p key={line} className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                              {line}
                            </p>
                          ))}
                        </div>
                        {msg.clarification.missing && msg.clarification.missing.length > 0 && (
                          <p className="mt-2 text-[12px] text-[var(--warning)]">
                            {`Da definire: ${msg.clarification.missing.join(", ")}`}
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                      {msg.clarification.question}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.clarification.options.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => handleGenerate(option)}
                          disabled={loading}
                          className="rounded-[999px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.04)] px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {(msg.reasoning || (msg.streaming && msg.strategyFlow)) && (
                  <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.025)] px-4 py-3.5">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
                      Reasoning
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-nowrap overflow-hidden text-ellipsis">
                      {msg.reasoning === "Reasoning complete"
                        ? "Reasoning complete"
                        : currentReasoningPhrase(msg.reasoning) || "Thinking..."}
                    </p>
                  </div>
                )}

                {(msg.code || msg.strategyFlow) && (
                  <div className="lpft-panel overflow-hidden rounded-[20px]">
                    <div className="px-3.5 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--code-bg)]/80">
                      <span className="text-[11px] text-[var(--text-tertiary)] tracking-wider uppercase">
                        Codice
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => saveStrategy(msg)}
                          className="h-6 px-2 rounded-lg text-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          disabled={!msg.code || savingCode === msg.code}
                        >
                          {savingCode === msg.code ? "Saving..." : "Save strategy"}
                        </button>
                        <button
                          type="button"
                          onClick={() => msg.code && setFullscreenCode(msg.code)}
                          className="h-6 px-2 rounded-lg text-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          disabled={!msg.code}
                        >
                          Fullscreen
                        </button>
                        <span className="lpft-code-badge">PY</span>
                      </div>
                    </div>
                    <pre className="lpft-code-block p-4 text-[12px] whitespace-pre-wrap overflow-auto max-h-[360px] scrollbar-thin">
                      {msg.streaming && !msg.code ? "Generating code..." : renderPythonCode(msg.code)}
                    </pre>
                  </div>
                )}

                {msg.runId != null && msg.code && (
                  <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.025)] px-4 py-3.5">
                    <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
                      Backtest
                    </p>
                    <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed whitespace-nowrap overflow-hidden text-ellipsis">
                      {formatRunStatus(msg.backtestStatus)}
                    </p>
                  </div>
                )}
              </div>
            )
          )}
          <div ref={chatEndRef} />

          {error && (
            <div className="rounded-[20px] border border-[var(--danger)]/30 bg-[var(--danger-muted)] px-4 py-3 flex items-center justify-between gap-2">
              <span className="text-[12px] text-[var(--danger)]">{error}</span>
              <button
                onClick={() => setError(null)}
                className="shrink-0 text-[11px] font-medium text-[var(--danger)] hover:underline"
              >
                Chiudi
              </button>
            </div>
          )}

          {saveNotice && (
            <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.03)] px-4 py-3">
              <span className="text-[12px] text-[var(--text-secondary)]">{saveNotice}</span>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 py-3">
        <div
          className={[
            "mx-auto flex flex-col gap-2.5",
            splitLayout ? "max-w-2xl" : "max-w-3xl w-full",
          ].join(" ")}
        >
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((a) => (
                <button
                  key={a.name}
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.name !== a.name))}
                  className="text-[11px] px-2.5 py-1.5 rounded-[999px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.04)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  title="Rimuovi allegato"
                >
                  {a.name} ×
                </button>
              ))}
            </div>
          )}

          <div className="rounded-[24px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.035)] px-3 py-3">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".txt,.md,.json,.py,.csv"
              className="hidden"
              onChange={(e) => onPickFiles(e.target.files)}
            />
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="Ask anything about markets, strategies, indicators, or your trading code..."
              rows={1}
              className="w-full min-h-[84px] max-h-[188px] px-3 py-2 bg-transparent text-[13px] leading-[1.55] tracking-[-0.01em] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] resize-none overflow-y-auto focus:outline-none"
              disabled={loading}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="shrink-0 h-[36px] w-[36px] rounded-[18px] text-[18px] leading-none font-medium border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:pointer-events-none bg-[rgba(255,255,255,0.04)] flex items-center justify-center"
                  title="Attach CSV"
                  aria-label="Attach CSV"
                >
                  +
                </button>
              </div>
              <button
                onClick={() => {
                  void handleGenerate();
                }}
                disabled={loading || (!input.trim() && attachments.length === 0)}
                className="btn-primary shrink-0 h-[36px] px-4 rounded-[18px] text-[12px] font-medium disabled:opacity-50 disabled:pointer-events-none"
              >
                {loading ? "…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {fullscreenCode && (
        <div className="fixed inset-0 z-50 bg-[#050507]">
          <div className="absolute inset-6 lpft-card">
            <div className="shrink-0 px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <p className="text-[11px] text-[var(--text-tertiary)] tracking-wider uppercase">Codice</p>
              <button
                type="button"
                onClick={() => setFullscreenCode(null)}
                className="h-8 px-3 rounded-lg text-[12px] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Chiudi
              </button>
            </div>
            <div className="flex-1 p-4 overflow-hidden">
              <pre className="lpft-code-block h-full p-4 text-[12px] whitespace-pre-wrap overflow-auto scrollbar-thin">
                {renderPythonCode(fullscreenCode)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BacktestColumn() {
  const [runId, setRunId] = useState<number | null>(null);
  const [run, setRun] = useState<RunOut | null>(null);
  const [equityData, setEquityData] = useState<LineData[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const [artifacts, setArtifacts] = useState<string[]>([]);
  const [trades, setTrades] = useState<
    { entry_time: number; exit_time: number; entry_price: number; exit_price: number; pnl_pct: number; pnl: number }[]
  >([]);
  const [tab, setTab] = useState<"backtest" | "metrics" | "parameters" | "trade">("backtest");
  const [range, setRange] = useState<"5y" | "2y" | "1y" | "6m" | "3m" | "1m">(DEFAULT_VIEW_RANGE);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenTab, setFullscreenTab] = useState<null | "metrics" | "parameters" | "trade">(null);
  const [programCode, setProgramCode] = useState<string>("");
  const [strategySpec, setStrategySpec] = useState<StrategySpec | null>(null);
  const [runParams, setRunParams] = useState<{ symbol?: string; period?: string; timeframe?: string; viewRange?: string } | null>(null);
  const [runValidation, setRunValidation] = useState<{
    status?: string;
    capability_summary?: string;
    warnings?: string[];
    strategy_kind?: string;
    symbols_used?: string[];
    data_policy?: {
      asset_class?: string;
      provider_preference?: string;
      quality_policy?: string;
      freshness_requirement?: string;
      coverage_requirement?: string;
      corporate_actions_required?: boolean;
      market?: string | null;
    };
    data_sources?: Array<{
      provider_requested?: string;
      provider_used?: string;
      asset_class?: string;
      canonical_symbol?: string;
      requested_symbol?: string;
      freshness_status?: string;
      coverage_status?: string;
      status?: string;
      rows?: number;
      warnings?: string[];
      fallback_used?: boolean;
    }>;
    data_error?: {
      summary?: string;
      warnings?: string[];
      symbol_errors?: Array<{
        summary?: string;
        warnings?: string[];
        canonical_symbol?: string;
        requested_symbol?: string;
        provider_used?: string;
        freshness_status?: string;
        coverage_status?: string;
        status?: string;
      }>;
    };
  } | null>(null);

  useEffect(() => {
    const handler = (
      e: CustomEvent<{ runId: number; code?: string; spec?: StrategySpec; params?: { symbol?: string; period?: string; timeframe?: string; viewRange?: string } }>
    ) => {
      setRunId(e.detail.runId);
      setRun(null);
      setEquityData([]);
      setMetrics(null);
      setArtifacts([]);
      setTrades([]);
      setRunValidation(null);
      setProgramCode(e.detail.code ?? "");
      setStrategySpec(e.detail.spec ?? null);
      setRunParams(e.detail.params ?? null);
      setTab("backtest");
      setRange(DEFAULT_VIEW_RANGE);
    };
    window.addEventListener("lpft-backtest-run", handler as EventListener);
    return () => window.removeEventListener("lpft-backtest-run", handler as EventListener);
  }, []);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.runs.get(runId);
        if (cancelled) return;
        setRun(r);
        if (r.status !== "completed" && r.status !== "failed") return;
        const [list, csvRes, metricsRes, validationRes] = await Promise.all([
          api.runs.artifacts(runId),
          fetch(artifactUrl(runId, "equity.csv")),
          fetch(artifactUrl(runId, "metrics.json")),
          fetch(artifactUrl(runId, "validation.json")),
        ]);
        if (cancelled) return;
        setArtifacts(list ?? []);
        const csv = await (csvRes.ok ? csvRes.text() : "");
        setEquityData(csv ? parseEquityCsv(csv) : []);
        if (metricsRes.ok) {
          const t = await metricsRes.text();
          if (t.trim()) {
            try {
              setMetrics(JSON.parse(t));
            } catch {
              setMetrics(null);
            }
          }
        } else {
          setMetrics(null);
        }
        if (validationRes.ok) {
          const validationText = await validationRes.text();
          if (validationText.trim()) {
            try {
              setRunValidation(JSON.parse(validationText));
            } catch {
              setRunValidation(null);
            }
          }
        } else {
          setRunValidation(null);
        }

        // trades.csv (opzionale)
        try {
          const tradesRes = await fetch(artifactUrl(runId, "trades.csv"));
          if (tradesRes.ok) {
            const tt = await tradesRes.text();
            setTrades(parseTradesCsv(tt));
          } else {
            setTrades([]);
          }
        } catch {
          setTrades([]);
        }
      } catch {
        if (!cancelled) setRun(null);
      }
    };
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [runId]);

  useEffect(() => {
    if (!runId || !run) return;
    window.dispatchEvent(
      new CustomEvent("lpft-backtest-status", {
        detail: { runId, status: run.status },
      })
    );
  }, [runId, run]);

  const loadingArtifacts = runId != null && run?.status === "completed" && equityData.length === 0;

  const defaultMetrics = {
    total_return: 0,
    net_pnl: 0,
    max_drawdown: 0,
    sharpe_ratio: 0,
    num_trades: 0,
    win_rate: 0,
    final_equity: 0,
  };

  const baseMetrics = (metrics ?? defaultMetrics) as Record<string, number>;

  const flatEquity: LineData[] = (() => {
    const now = Math.floor(Date.now() / 1000);
    const points: LineData[] = [];
    for (let i = 29; i >= 0; i--) {
      points.push({ time: (now - i * 24 * 3600) as any, value: 10_000 });
    }
    return points;
  })();

  const cutoffForRange = (last: number) => {
    const days =
      range === "5y"
        ? 365 * 5
        : range === "2y"
          ? 365 * 2
          : range === "1y"
            ? 365
            : range === "6m"
              ? 30 * 6
              : range === "3m"
                ? 30 * 3
                : 30;
    return last - days * 24 * 3600;
  };

  const dataForRange = (data: LineData[]) => {
    if (!data || data.length === 0) return [];
    const last = Number(data[data.length - 1].time);
    const cutoff = cutoffForRange(last);
    return data.filter((d) => Number(d.time) >= cutoff);
  };

  const baseEquity = equityData.length > 0 ? equityData : flatEquity;
  const chartData = dataForRange(baseEquity);
  const chartVisibleRange =
    baseEquity.length > 0
      ? {
          from: cutoffForRange(Number(baseEquity[baseEquity.length - 1].time)),
          to: Number(baseEquity[baseEquity.length - 1].time),
        }
      : null;
  const chartKey = `${runId ?? 0}:${range}:${chartData.length > 0 ? Number(chartData[0].time) : 0}`;
  const filteredTrades = (() => {
    if (!trades.length) return [];
    const last = Number(baseEquity[baseEquity.length - 1]?.time ?? 0);
    if (!last) return trades;
    const cutoff = cutoffForRange(last);
    return trades.filter((t) => t.exit_time >= cutoff && t.exit_time <= last);
  })();

  const rangeMetrics = (() => {
    if (!chartData || chartData.length < 2) {
      return {
        total_return: 0,
        net_pnl: 0,
        max_drawdown: 0,
        sharpe_ratio: 0,
        final_equity: 0,
        num_trades: filteredTrades.length,
        win_rate: 0,
      };
    }
    const values = chartData.map((d) => d.value);
    const first = values[0] ?? 0;
    const last = values[values.length - 1] ?? 0;
    const total_return = first !== 0 ? last / first - 1 : 0;
    const net_pnl = last - first;
    let peak = -Infinity;
    let maxDd = 0;
    for (const v of values) {
      peak = Math.max(peak, v);
      if (peak > 0) maxDd = Math.min(maxDd, v / peak - 1);
    }
    // Sharpe approssimato (daily)
    const rets: number[] = [];
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1];
      const cur = values[i];
      rets.push(prev !== 0 ? cur / prev - 1 : 0);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
    const var_ = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length || 1);
    const std = Math.sqrt(var_);
    const sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
    return {
      total_return,
      net_pnl,
      max_drawdown: maxDd,
      sharpe_ratio: sharpe,
      final_equity: last,
      num_trades: filteredTrades.length,
      win_rate:
        filteredTrades.length > 0
          ? filteredTrades.filter((t) => t.pnl > 0).length / filteredTrades.length
          : 0,
    };
  })();
  const chartColorMode: "positive" | "negative" | "neutral" =
    !chartData.length || Math.abs(rangeMetrics.total_return ?? 0) < 1e-9
      ? "neutral"
      : (rangeMetrics.total_return ?? 0) > 0
        ? "positive"
        : "negative";
  const parameterRows = buildParameterRows(strategySpec, runParams, run);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-4 pt-3 pb-2 border-b border-[var(--border-subtle)]">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[11px] text-[var(--text-tertiary)] tracking-wider uppercase">Results</p>
            <p className="text-[12px] text-[var(--text-secondary)] mt-0.5 font-mono">
              {runId == null
                ? "API: localhost:8000"
                : run
                  ? `#${run.id} · ${run.symbol ?? "—"} · ${run.status}`
                  : "Caricamento…"}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(
              [
                ["backtest", "Backtest"],
                ["metrics", "Metrics"],
                ["parameters", "Parameters"],
                ["trade", "Trade"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={[
                  "h-7 px-2.5 rounded-lg text-[11px] border",
                  tab === id
                    ? "border-[rgba(124,58,237,0.35)] text-[var(--text-primary)] bg-[rgba(124,58,237,0.15)]"
                    : "border-[var(--border-subtle)] text-[var(--text-secondary)] bg-transparent hover:text-[var(--text-primary)]",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {tab === "backtest" && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-[var(--text-secondary)]">Equity curve</p>
              <div className="flex items-center gap-1.5">
                {(
                  [
                    ["5y", "5Y"],
                    ["2y", "2Y"],
                    ["1y", "1Y"],
                    ["6m", "6M"],
                    ["3m", "3M"],
                    ["1m", "1M"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRange(id)}
                    className={[
                      "h-6 px-2 rounded-lg text-[10px] border",
                      range === id
                        ? "border-[rgba(124,58,237,0.35)] text-[var(--text-primary)] bg-[rgba(124,58,237,0.15)]"
                        : "border-[var(--border-subtle)] text-[var(--text-secondary)] bg-transparent hover:text-[var(--text-primary)]",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setFullscreen(true)}
                  className="h-6 px-2 rounded-lg text-[10px] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  title="Fullscreen"
                >
                  Fullscreen
                </button>
              </div>
            </div>

            <div className="lpft-panel overflow-hidden">
              <EquityChart
                data={chartData}
                height={220}
                loading={runId != null ? (run?.status !== "completed" || loadingArtifacts) : false}
                colorMode={chartColorMode}
                visibleRange={chartVisibleRange}
                key={chartKey}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="lpft-panel p-3">
                <p className="text-[10px] text-[var(--text-tertiary)]">Return</p>
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {(((rangeMetrics.total_return ?? 0) as number) * 100).toFixed(2)}%
                </p>
              </div>
              <div className="lpft-panel p-3">
                <p className="text-[10px] text-[var(--text-tertiary)]">Net PnL</p>
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {(rangeMetrics.net_pnl ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="lpft-panel p-3">
                <p className="text-[10px] text-[var(--text-tertiary)]">Max drawdown</p>
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {(((rangeMetrics.max_drawdown ?? 0) as number) * 100).toFixed(2)}%
                </p>
              </div>
              <div className="lpft-panel p-3">
                <p className="text-[10px] text-[var(--text-tertiary)]">Sharpe</p>
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {(rangeMetrics.sharpe_ratio ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="lpft-panel p-3">
                <p className="text-[10px] text-[var(--text-tertiary)]">Trades</p>
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {(rangeMetrics.num_trades ?? 0).toFixed(0)}
                </p>
              </div>
              <div className="lpft-panel p-3">
                <p className="text-[10px] text-[var(--text-tertiary)]">Win rate</p>
                <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                  {(((rangeMetrics.win_rate ?? 0) as number) * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </>
        )}

        {tab === "metrics" && (
          <div className="lpft-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="lpft-panel-header">Metriche</p>
              <button
                type="button"
                onClick={() => setFullscreenTab("metrics")}
                className="h-7 px-2.5 rounded-lg text-[11px] border border-[var(--border-subtle)] text-[var(--text-secondary)] bg-transparent hover:text-[var(--text-primary)]"
                title="Fullscreen"
              >
                Fullscreen
              </button>
            </div>
            <MetricsTable
              rows={[
                ["Return", `${((rangeMetrics.total_return ?? 0) * 100).toFixed(2)}%`],
                ["Net PnL", (rangeMetrics.net_pnl ?? 0).toFixed(2)],
                ["Max drawdown", `${((rangeMetrics.max_drawdown ?? 0) * 100).toFixed(2)}%`],
                ["Sharpe", (rangeMetrics.sharpe_ratio ?? 0).toFixed(2)],
                ["Trades", `${(rangeMetrics.num_trades ?? 0).toFixed(0)}`],
                ["Win rate", `${((rangeMetrics.win_rate ?? 0) * 100).toFixed(1)}%`],
                ["Final equity", (rangeMetrics.final_equity ?? 0).toFixed(2)],
              ]}
            />
          </div>
        )}

        {tab === "parameters" && (
          <div className="lpft-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="lpft-panel-header">Parameters</p>
              <button
                type="button"
                onClick={() => setFullscreenTab("parameters")}
                className="h-7 px-2.5 rounded-lg text-[11px] border border-[var(--border-subtle)] text-[var(--text-secondary)] bg-transparent hover:text-[var(--text-primary)]"
                title="Fullscreen"
              >
                Fullscreen
              </button>
            </div>
            <ParameterTable rows={parameterRows} />
          </div>
        )}

        {tab === "trade" && (
          <div className="lpft-panel p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="lpft-panel-header">Trade</p>
              <button
                type="button"
                onClick={() => setFullscreenTab("trade")}
                className="h-7 px-2.5 rounded-lg text-[11px] border border-[var(--border-subtle)] text-[var(--text-secondary)] bg-transparent hover:text-[var(--text-primary)]"
                title="Fullscreen"
              >
                Fullscreen
              </button>
            </div>
            <TradesTable trades={filteredTrades} />
          </div>
        )}

        {run?.status === "failed" && run.error && (
          <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger-muted)] px-3.5 py-2.5 text-[12px] text-[var(--danger)]">
            {run.error}
          </div>
        )}
        {run?.status === "running" && (
          <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-muted)] px-3.5 py-2.5 text-[12px] text-[var(--accent)] flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)] animate-pulse" />
            In esecuzione…
          </div>
        )}
        {runValidation && (
          <div className="rounded-[20px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.025)] px-4 py-3.5">
            <p className="text-[11px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1.5">
              Validation
            </p>
            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
              {runValidation.capability_summary ?? "Shared engine validation available."}
            </p>
            {runValidation.strategy_kind && (
              <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
                Kind: {runValidation.strategy_kind}
                {runValidation.symbols_used && runValidation.symbols_used.length > 0
                  ? ` · Symbols: ${runValidation.symbols_used.join(", ")}`
                  : ""}
              </p>
            )}
            {runValidation.data_policy && (
              <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">
                {`Asset: ${runValidation.data_policy.asset_class ?? "auto"} · Provider: ${runValidation.data_policy.provider_preference ?? "auto"} · Policy: ${runValidation.data_policy.quality_policy ?? "best_effort"}`}
              </p>
            )}
            {renderDataSources(runValidation.data_sources)}
            {runValidation.data_error?.summary && (
              <p className="mt-2 text-[12px] text-[var(--danger)] leading-relaxed">
                {runValidation.data_error.summary}
              </p>
            )}
            {runValidation.data_error?.symbol_errors &&
              renderDataSources(
                runValidation.data_error.symbol_errors.map((item) => ({
                  canonical_symbol: item.canonical_symbol,
                  requested_symbol: item.requested_symbol,
                  provider_used: item.provider_used,
                  freshness_status: item.freshness_status,
                  coverage_status: item.coverage_status,
                  status: item.status,
                  warnings: item.warnings,
                }))
              )}
            {runValidation.warnings && runValidation.warnings.length > 0 && (
              <div className="mt-2 space-y-1">
                {runValidation.warnings.map((warning, index) => (
                  <p key={`${warning}-${index}`} className="text-[12px] text-[var(--text-tertiary)] leading-relaxed">
                    {warning}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
        {artifacts.length > 0 && (
          <div className="lpft-panel p-3.5">
            <p className="lpft-panel-header mb-2">File</p>
            <div className="flex flex-wrap gap-2">
              {artifacts.map((f) => (
                <a
                  key={f}
                  href={runId ? artifactUrl(runId, f) : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-[var(--accent)] hover:underline"
                >
                  {f}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-[#050507]">
          <div className="absolute inset-6 lpft-card">
            <div className="shrink-0 px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <p className="text-[12px] text-[var(--text-secondary)]">Equity curve</p>
              <button
                type="button"
                onClick={() => setFullscreen(false)}
                className="h-8 px-3 rounded-lg text-[12px] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Chiudi
              </button>
            </div>
            <div className="flex-1 p-4">
              <div className="lpft-panel h-full overflow-hidden">
                <EquityChart
                  data={chartData}
                  height={640}
                  loading={false}
                  colorMode={chartColorMode}
                  visibleRange={chartVisibleRange}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {fullscreenTab && (
        <div className="fixed inset-0 z-50 bg-[#050507]">
          <div className="absolute inset-6 lpft-card">
            <div className="shrink-0 px-4 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between">
              <p className="text-[12px] text-[var(--text-secondary)]">
                {fullscreenTab === "metrics" ? "Metrics" : fullscreenTab === "parameters" ? "Parameters" : "Trade"}
              </p>
              <button
                type="button"
                onClick={() => setFullscreenTab(null)}
                className="h-8 px-3 rounded-lg text-[12px] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Chiudi
              </button>
            </div>
            <div className="flex-1 p-4 overflow-auto scrollbar-thin">
              {fullscreenTab === "metrics" && (
                <MetricsTable
                  rows={[
                    ["Return", `${((rangeMetrics.total_return ?? 0) * 100).toFixed(2)}%`],
                    ["Net PnL", (rangeMetrics.net_pnl ?? 0).toFixed(2)],
                    ["Max drawdown", `${((rangeMetrics.max_drawdown ?? 0) * 100).toFixed(2)}%`],
                    ["Sharpe", (rangeMetrics.sharpe_ratio ?? 0).toFixed(2)],
                    ["Trades", `${(rangeMetrics.num_trades ?? 0).toFixed(0)}`],
                    ["Win rate", `${((rangeMetrics.win_rate ?? 0) * 100).toFixed(1)}%`],
                    ["Final equity", (rangeMetrics.final_equity ?? 0).toFixed(2)],
                  ]}
                />
              )}
              {fullscreenTab === "parameters" && <ParameterTable rows={parameterRows} />}
              {fullscreenTab === "trade" && <TradesTable trades={filteredTrades} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
