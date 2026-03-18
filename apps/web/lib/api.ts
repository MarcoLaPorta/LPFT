/**
 * API base URL (LPFT backend).
 */
export const API_BASE =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_LPFT_API_BASE ?? process.env.NEXT_PUBLIC_API_URL)
    ? (process.env.NEXT_PUBLIC_LPFT_API_BASE ?? process.env.NEXT_PUBLIC_API_URL)!
    : "http://localhost:8000";

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
  risk?: { max_position_pct?: number };
  universe: { symbols: string[]; timeframe: string };
}

export interface GenerateAndBacktestResponse {
  run_id: number;
  program_code: string;
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
      const res = await fetch(`${API_BASE}/generate-strategy-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
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
                else if (data.type === "spec" && data.spec) callbacks.onSpec(data.spec as StrategySpec);
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
    fetch: async (symbol: string, period?: string, interval?: string) => {
      const params = new URLSearchParams({
        symbol,
        period: period ?? "1y",
        interval: interval ?? "1d",
      });
      const res = await fetch(`${API_BASE}/datasets/fetch?${params}`, { method: "POST" });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      if (!text.trim()) throw new Error("Risposta vuota");
      try {
        return JSON.parse(text) as { symbol: string; period: string; interval: string; rows: number; path: string | null };
      } catch {
        throw new Error("Risposta API non valida (non JSON)");
      }
    },
  },
};
