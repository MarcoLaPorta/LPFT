/**
 * API base URL (LPFT backend).
 * In sviluppo, se non e' configurato esplicitamente, usiamo l'hostname
 * della pagina corrente cosi' il browser non prova a contattare il proprio localhost.
 */
function resolveApiBase(): string {
  const explicitBase =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_LPFT_API_BASE ?? process.env.NEXT_PUBLIC_API_URL
      : undefined;
  if (explicitBase) return explicitBase;
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    return `${protocol}//${window.location.hostname}:8000`;
  }
  return "http://localhost:8000";
}

export const API_BASE = resolveApiBase();

export function datasetFileUrl(filename: string): string {
  return `${API_BASE}/datasets/files/${encodeURIComponent(filename)}`;
}

export function artifactUrl(runId: number, filename: string): string {
  return `${API_BASE}/runs/${runId}/artifacts/${encodeURIComponent(filename)}`;
}

// --- Types (mirror backend schemas) ---
export type RunStatus = "pending" | "running" | "completed" | "failed";
export type RunType = "backtest" | "live";

export interface StrategyOut {
  id: number;
  name: string;
  spec: Record<string, unknown>;
}

export interface RunOut {
  id: number;
  strategy_id: number | null;
  status: RunStatus;
  run_type: RunType;
  program_code: string | null;
  period: string | null;
  timeframe: string | null;
  symbol: string | null;
  created_at: string;
  error: string | null;
}

export interface StrategySpec {
  kind: string;
  params: Record<string, unknown>;
  risk?: {
    max_position_pct?: number;
    max_gross_exposure?: number;
    stop_loss_pct?: number | null;
    take_profit_pct?: number | null;
    trailing_stop_pct?: number | null;
    fee_bps?: number;
    slippage_bps?: number;
  };
  universe: { symbols: string[]; timeframe: string };
  execution?: {
    position_mode?: "long_only" | "long_short";
    rebalance?: "equal_weight" | "dynamic";
    entry_timing?: "next_bar_open" | "bar_close";
  };
  data?: {
    market_model?: "ohlcv" | "bid_ask" | "order_book" | "options";
    requires_intrabar?: boolean;
    asset_class?: "auto" | "equity" | "etf" | "crypto";
    provider_preference?: "auto" | "yahoo" | "stooq" | "alpaca";
    quality_policy?: "strict_gate" | "quality_labels" | "best_effort";
    freshness_requirement?: "relaxed" | "standard" | "strict";
    coverage_requirement?: "relaxed" | "standard" | "strict";
    corporate_actions_required?: boolean;
    market?: string | null;
    notes?: string | null;
    /** Storico OHLCV per backtest (1m|3m|6m|1y|2y|5y); se assente usa il default client. */
    history_period?: "1m" | "3m" | "6m" | "1y" | "2y" | "5y" | null;
  };
}

export interface CapabilityReport {
  status:
    | "supported"
    | "supported_with_warnings"
    | "unsupported_with_conversion_path"
    | "unsupported_missing_data";
  summary: string;
  warnings: string[];
  missing_requirements: string[];
  conversion_suggestions: string[];
  engine_path: string;
  asset_class: string;
  provider_plan: string;
  quality_policy: string;
}

export interface ValidationSummary {
  status: string;
  summary: string;
  warnings: string[];
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
}

export interface GenerateAndBacktestResponse {
  run_id: number;
  program_code: string;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantStreamRequest {
  messages: AssistantMessage[];
  current_run_id?: number | null;
  current_code?: string | null;
  current_spec?: StrategySpec | null;
  symbol?: string;
  period?: string;
  timeframe?: string;
}

async function req<T>(
  path: string,
  options?: RequestInit & { params?: Record<string, string> }
): Promise<T> {
  const { params, ...init } = options ?? {};
  const url = params ? `${API_BASE}${path}?${new URLSearchParams(params)}` : `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed")) {
      throw new Error("Impossibile contattare l'API. Verifica che sia avviata su " + API_BASE);
    }
    throw e;
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = `Errore ${res.status}`;
    if (text.trim()) {
      try {
        const err = JSON.parse(text) as { detail?: string | { msg?: string }[] };
        if (typeof err.detail === "string") msg = err.detail;
        else if (Array.isArray(err.detail)) msg = err.detail.map((d) => (d && typeof d === "object" && "msg" in d ? d.msg : "")).filter(Boolean).join(" ") || msg;
      } catch {
        msg = text.length > 200 ? text.slice(0, 200) + "…" : text;
      }
    }
    // Messaggio user-friendly se il server restituisce l'errore di parsing JSON
    if (msg.includes("Expecting value") && msg.includes("char 0")) {
      msg = "L'LLM non ha restituito una risposta valida. Riprova tra qualche secondo.";
    }
    throw new Error(msg);
  }
  if (res.status === 204 || !text.trim()) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Risposta API non valida (non JSON)");
  }
}

export const api = {
  strategies: {
    list: () => req<StrategyOut[]>("/strategies"),
    create: (body: { name: string; spec: StrategySpec }) =>
      req<StrategyOut>("/strategies", { method: "POST", body: JSON.stringify(body) }),
  },
  runs: {
    list: () => req<RunOut[]>("/runs"),
    get: (id: number) => req<RunOut>(`/runs/${id}`),
    create: (body: {
      strategy_id: number;
      run_type?: RunType;
      period?: string;
      timeframe?: string;
      symbol?: string;
    }) => req<RunOut>("/runs", { method: "POST", body: JSON.stringify(body) }),
    runProgram: (runId: number) =>
      req<{ run_id: number; status: RunStatus }>("/runs/program", {
        method: "POST",
        body: JSON.stringify({ run_id: runId }),
      }),
    artifacts: (runId: number) => req<string[]>(`/runs/${runId}/artifacts`),
  },
  generate: {
    strategy: (description: string) =>
      req<{ spec: StrategySpec }>("/generate-strategy", {
        method: "POST",
        body: JSON.stringify({ description }),
      }),
    /** Stream: onReasoningChunk(chunk), onSpec(spec), onError(detail). */
    strategyStream: async (
      description: string,
      callbacks: {
        onReasoningChunk: (chunk: string) => void;
        onSpec: (spec: StrategySpec) => void;
        onError: (detail: string) => void;
      }
    ): Promise<void> => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/generate-strategy-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed")) {
          callbacks.onError("Impossibile contattare l'API. Verifica che sia avviata su " + API_BASE);
          return;
        }
        callbacks.onError(msg);
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        let msg = `Errore ${res.status}`;
        if (text.trim()) {
          try {
            const err = JSON.parse(text) as { detail?: string };
            if (typeof err.detail === "string") msg = err.detail;
          } catch {
            msg = text.slice(0, 200);
          }
        }
        callbacks.onError(msg);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("Stream non disponibile");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6)) as {
                  type: string;
                  chunk?: string;
                  spec?: Record<string, unknown>;
                  detail?: string;
                };
                if (data.type === "reasoning" && typeof data.chunk === "string") callbacks.onReasoningChunk(data.chunk);
                else if (data.type === "spec" && data.spec) callbacks.onSpec(data.spec as unknown as StrategySpec);
                else if (data.type === "error" && typeof data.detail === "string") callbacks.onError(data.detail);
              } catch {
                /* ignore parse errors for incomplete chunks */
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
    program: (strategySpec: StrategySpec) =>
      req<{ program: { code: string; language: string } }>("/generate-program", {
        method: "POST",
        body: JSON.stringify({ strategy_spec: strategySpec }),
      }),
    andBacktest: (body: {
      strategy_spec: StrategySpec;
      period?: string;
      timeframe?: string;
      symbol?: string;
    }) =>
      req<GenerateAndBacktestResponse>("/generate-and-backtest", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
  assistant: {
    stream: async (
      body: AssistantStreamRequest,
      callbacks: {
        onAssistantChunk: (chunk: string) => void;
        onReasoningChunk: (chunk: string) => void;
        onSpec: (spec: StrategySpec) => void;
        onCode: (code: string) => void;
        onCapability: (payload: CapabilityReport) => void;
        onValidation: (payload: ValidationSummary) => void;
        onUnsupportedStrategy: (payload: {
          detail: string;
          missing_requirements: string[];
          conversion_suggestions: string[];
          warnings: string[];
        }) => void;
        onRunStatus: (payload: { run_id: number; status: RunStatus }) => void;
        onClarification: (payload: { question: string; options: string[]; summary?: string[]; missing?: string[] }) => void;
        onRun: (payload: {
          run_id: number;
          code: string;
          spec: StrategySpec;
          params: { symbol?: string; period?: string; timeframe?: string };
        }) => void;
        onDone: () => void;
        onError: (detail: string) => void;
      }
    ): Promise<void> => {
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/assistant/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("Load failed")) {
          callbacks.onError("Impossibile contattare l'API. Verifica che sia avviata su " + API_BASE);
          return;
        }
        callbacks.onError(msg);
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        let msg = `Errore ${res.status}`;
        if (text.trim()) {
          try {
            const err = JSON.parse(text) as { detail?: string };
            if (typeof err.detail === "string") msg = err.detail;
          } catch {
            msg = text.slice(0, 200);
          }
        }
        callbacks.onError(msg);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        callbacks.onError("Stream non disponibile");
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6)) as {
                type: string;
                chunk?: string;
                detail?: string;
                code?: string;
                spec?: Record<string, unknown>;
                run_id?: number;
                status?: RunStatus;
                params?: { symbol?: string; period?: string; timeframe?: string };
                question?: string;
                options?: string[];
                summary?: string[];
                missing?: string[];
                capability?: CapabilityReport;
                validation?: ValidationSummary;
                missing_requirements?: string[];
                conversion_suggestions?: string[];
                warnings?: string[];
              };
              if (data.type === "assistant" && typeof data.chunk === "string") callbacks.onAssistantChunk(data.chunk);
              else if (data.type === "reasoning" && typeof data.chunk === "string") callbacks.onReasoningChunk(data.chunk);
              else if (data.type === "spec" && data.spec) callbacks.onSpec(data.spec as unknown as StrategySpec);
              else if (data.type === "code" && typeof data.code === "string") callbacks.onCode(data.code);
              else if (data.type === "capability" && data.capability) callbacks.onCapability(data.capability);
              else if (data.type === "validation" && data.validation) callbacks.onValidation(data.validation);
              else if (data.type === "unsupported_strategy" && typeof data.detail === "string") {
                callbacks.onUnsupportedStrategy({
                  detail: data.detail,
                  missing_requirements: Array.isArray(data.missing_requirements)
                    ? data.missing_requirements.filter(
                        (item): item is string => typeof item === "string"
                      )
                    : [],
                  conversion_suggestions: Array.isArray(data.conversion_suggestions)
                    ? data.conversion_suggestions.filter(
                        (item): item is string => typeof item === "string"
                      )
                    : [],
                  warnings: Array.isArray(data.warnings)
                    ? data.warnings.filter((item): item is string => typeof item === "string")
                    : [],
                });
              }
              else if (
                data.type === "run_status" &&
                typeof data.run_id === "number" &&
                typeof data.status === "string"
              ) {
                callbacks.onRunStatus({ run_id: data.run_id, status: data.status });
              }
              else if (data.type === "clarification" && typeof data.question === "string") {
                callbacks.onClarification({
                  question: data.question,
                  options: Array.isArray(data.options) ? data.options.filter((option): option is string => typeof option === "string") : [],
                  summary: Array.isArray(data.summary) ? data.summary.filter((item): item is string => typeof item === "string") : [],
                  missing: Array.isArray(data.missing) ? data.missing.filter((item): item is string => typeof item === "string") : [],
                });
              }
              else if (data.type === "run" && data.spec && typeof data.code === "string" && typeof data.run_id === "number") {
                callbacks.onRun({
                  run_id: data.run_id,
                  code: data.code,
                  spec: data.spec as unknown as StrategySpec,
                  params: data.params ?? {},
                });
              } else if (data.type === "done") callbacks.onDone();
              else if (data.type === "error" && typeof data.detail === "string") callbacks.onError(data.detail);
            } catch {
              /* ignore parse errors for incomplete chunks */
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  },
  datasets: {
    upload: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_BASE}/datasets/upload`, {
        method: "POST",
        body: form,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      if (!text.trim()) throw new Error("Risposta vuota");
      try {
        return JSON.parse(text) as { filename: string; path: string };
      } catch {
        throw new Error("Risposta API non valida (non JSON)");
      }
    },
    fetch: async (
      symbol: string,
      period?: string,
      interval?: string,
      options?: {
        asset_class?: "auto" | "equity" | "etf" | "crypto";
        provider_preference?: "auto" | "yahoo" | "stooq" | "alpaca";
        quality_policy?: "strict_gate" | "quality_labels" | "best_effort";
      }
    ) => {
      const params = new URLSearchParams({
        symbol,
        period: period ?? "1y",
        interval: interval ?? "1d",
        asset_class: options?.asset_class ?? "auto",
        provider_preference: options?.provider_preference ?? "auto",
        quality_policy: options?.quality_policy ?? "best_effort",
      });
      const res = await fetch(`${API_BASE}/datasets/fetch?${params}`, { method: "POST" });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      if (!text.trim()) throw new Error("Risposta vuota");
      try {
        return JSON.parse(text) as {
          symbol: string;
          period: string;
          interval: string;
          rows: number;
          path: string | null;
          provider_used?: string | null;
          asset_class?: string | null;
          quality_status?: string | null;
          freshness_status?: string | null;
          coverage_status?: string | null;
          warnings?: string[];
        };
      } catch {
        throw new Error("Risposta API non valida (non JSON)");
      }
    },
  },
};
