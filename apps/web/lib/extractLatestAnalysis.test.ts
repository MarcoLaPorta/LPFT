import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { extractLatestAnalysis, lastUserMessageIndex } from "./extractLatestAnalysis";

function userMsg(text: string, id = "u"): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistantWithQuant(
  symbol: string,
  id: string,
  cagr = 0.1,
): UIMessage {
  const series = [
    { date: "2024-01-01", equity: 1, benchmark: 1 },
    { date: "2024-01-02", equity: 1 + cagr, benchmark: 1 },
  ];
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-buildQuantitativeStrategy",
        toolCallId: `tc-${id}`,
        state: "output-available",
        input: {},
        output: {
          success: true,
          widget: "quant_strategy_v1",
          symbol,
          benchmark: "^GSPC",
          series,
          metrics: { cagr, sharpe: 1, maxDrawdown: -0.05 },
          benchmarkMetrics: { cagr: 0.05, sharpe: 0.5, maxDrawdown: -0.1 },
          compiledStrategy: { backtest: { primaryTicker: symbol } },
        },
      },
    ],
  };
}

describe("extractLatestAnalysis — turno corrente", () => {
  it("lastUserMessageIndex trova l'ultimo messaggio utente", () => {
    const messages = [userMsg("a", "u1"), assistantWithQuant("AAPL", "a1"), userMsg("b", "u2")];
    expect(lastUserMessageIndex(messages)).toBe(2);
  });

  it("non riusa il backtest di un turno precedente", () => {
    const messages = [
      userMsg("strategia SPY", "u1"),
      assistantWithQuant("SPY", "a1", 0.12),
      userMsg("riscrivi per QQQ", "u2"),
      {
        id: "a2-partial",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: "Sto ricalcolando…" }],
      },
    ];

    const snap = extractLatestAnalysis(messages);
    expect(snap).toBeNull();
  });

  it("mostra solo la strategia del turno corrente dopo risposta completa", () => {
    const messages = [
      userMsg("SPY", "u1"),
      assistantWithQuant("SPY", "a1", 0.12),
      userMsg("QQQ", "u2"),
      assistantWithQuant("QQQ", "a2", 0.2),
    ];

    const snap = extractLatestAnalysis(messages);
    expect(snap?.symbol).toBe("QQQ");
    expect(snap?.metrics?.cagr).toBeCloseTo(0.2, 6);
  });
});
