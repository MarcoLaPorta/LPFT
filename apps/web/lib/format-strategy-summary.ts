type CompiledStrategy = {
  intentClass?: string;
  intentSummary?: string;
  universe?: { assets?: string[]; baseCurrency?: string };
  walletLogic?: {
    rebalanceFrequency?: string;
    weighting?: string;
    macroNotes?: string;
  };
  algoLogic?: {
    signal?: string;
    sma?: { fastPeriod?: number; slowPeriod?: number };
    rsi?: { period?: number; oversold?: number; overbought?: number };
    zScore?: { lookback?: number; entryZ?: number; exitZ?: number };
    asymmetricTrendMomentum?: {
      lookbackPeriodDays?: number;
      equityTicker?: string;
      cryptoTicker?: string;
      safeHavenTicker?: string;
    };
  };
  riskManagement?: {
    maxDrawdownLimit?: number;
    stopLossPercentage?: number;
    trailingStop?: boolean;
    makerFeeBps?: number;
    takerFeeBps?: number;
    slippageBps?: number;
  };
  backtest?: { primaryTicker?: string; benchmark?: string; timeframe?: string };
};

const SIGNAL_LABELS: Record<string, string> = {
  SMA_CROSSOVER: "Crossover medie mobili",
  RSI: "RSI mean-reversion",
  Z_SCORE: "Z-score mean-reversion",
  MACRO_ALLOCATION: "Allocazione macro",
  MACRO_REGIME_BREAKOUT: "Regime breakout macro",
  DUAL_MOMENTUM: "Dual momentum",
  ASYMMETRIC_TREND_MOMENTUM: "Trend momentum asimmetrico",
};

export function summarizeCompiledStrategy(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const s = raw as CompiledStrategy;
  const lines: string[] = [];

  if (s.intentClass) {
    lines.push(
      s.intentClass === "WALLET_MANAGEMENT"
        ? "Gestione portafoglio / protezione capitale"
        : "Trading algoritmico",
    );
  }

  if (s.algoLogic?.signal) {
    const label = SIGNAL_LABELS[s.algoLogic.signal] ?? s.algoLogic.signal;
    lines.push(`Segnale: ${label}`);
    if (s.algoLogic.signal === "SMA_CROSSOVER" && s.algoLogic.sma) {
      lines.push(`SMA ${s.algoLogic.sma.fastPeriod}/${s.algoLogic.sma.slowPeriod}`);
    }
    if (s.algoLogic.signal === "RSI" && s.algoLogic.rsi) {
      lines.push(
        `RSI(${s.algoLogic.rsi.period}) · oversold ${s.algoLogic.rsi.oversold} · overbought ${s.algoLogic.rsi.overbought}`,
      );
    }
    if (s.algoLogic.signal === "ASYMMETRIC_TREND_MOMENTUM" && s.algoLogic.asymmetricTrendMomentum) {
      const p = s.algoLogic.asymmetricTrendMomentum;
      lines.push(
        `ROC ${p.lookbackPeriodDays ?? 90}g · ${p.equityTicker ?? "QQQ"} vs ${p.cryptoTicker ?? "BTC-USD"} · safe ${p.safeHavenTicker ?? "GLD"}`,
      );
    }
  }

  if (s.walletLogic) {
    lines.push(
      `Ribilanciamento ${s.walletLogic.rebalanceFrequency ?? "—"} · pesatura ${s.walletLogic.weighting ?? "—"}`,
    );
  }

  if (s.universe?.assets?.length) {
    lines.push(`Universo: ${s.universe.assets.join(", ")}${s.universe.baseCurrency ? ` (${s.universe.baseCurrency})` : ""}`);
  }

  if (s.riskManagement) {
    const r = s.riskManagement;
    lines.push(
      `Risk cap DD ${((r.maxDrawdownLimit ?? 0) * 100).toFixed(0)}% · stop ${((r.stopLossPercentage ?? 0) * 100).toFixed(0)}%${r.trailingStop ? " · trailing" : ""}`,
    );
    if (r.slippageBps || r.takerFeeBps) {
      lines.push(
        `Slippage ${r.slippageBps ?? 0} bps · taker ${r.takerFeeBps ?? 5} bps · maker ${r.makerFeeBps ?? 0} bps`,
      );
    }
  }

  if (s.backtest?.timeframe) {
    lines.push(`Backtest ${s.backtest.timeframe} su ${s.backtest.primaryTicker ?? "—"} vs ${s.backtest.benchmark ?? "^GSPC"}`);
  }

  return lines;
}

export function sourceLabel(source: string): string {
  const map: Record<string, string> = {
    buildQuantitativeStrategy: "Quant Engine",
    runStrategyBacktest: "Backtest",
    proposeExecution: "Proposta esecuzione",
    analyzeMarketData: "Dati mercato",
  };
  return map[source] ?? source;
}

export function routingLabel(mode?: string): string {
  const map: Record<string, string> = {
    PRIMARY_MINT_BURN: "Primario mint/burn",
    PRIMARY_RFQ_ATOMIC: "Primario RFQ",
    SECONDARY_AMM: "Secondario AMM",
  };
  return mode ? (map[mode] ?? mode) : "—";
}
