/** Configurazione rigida per scalping / HFT (parallela al motore daily). */
export type HFTStrategyConfig = {
  primaryTicker: string;
  benchmark: string;
  universe: string[];
  maxLatencyMs: number;
  /** Soglia imbalance order book (0–1, es. 0.65 = 65% bid-side dominance). */
  orderBookImbalanceTrigger: number;
  microStopLossBps: number;
  executionTimeoutSeconds: number;
  /** Profitto minimo atteso per round-trip in bps (guardrail spread). */
  targetProfitBps: number;
  /** Spread + fee stimati per gamba (bps). */
  estimatedSpreadBps: number;
  /** true = maker (limit passivo); false = taker (market aggressivo). */
  useLimitOrdersOnly: boolean;
  /** Slippage per gamba taker (bps) — da riskManagement. */
  slippageBps: number;
  /** Fee maker istituzionale (bps sul notional). Default 0 = rebate/zero. */
  makerFeeBps: number;
  /** Fee taker istituzionale (bps sul notional). Default 5 bps. */
  takerFeeBps: number;
};

export type HFTTick = {
  ts: number;
  price: number;
  size: number;
};

export type HFTOrderBookLevel = { price: number; size: number };

export type HFTOrderBookSnapshot = {
  ts: number;
  bids: HFTOrderBookLevel[];
  asks: HFTOrderBookLevel[];
};

export type HFTScalpTrade = {
  tradeIndex: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  side: "long" | "short";
  pnlBps: number;
  reasonEntry: string;
  reasonExit: string;
};

export type HFTSessionResult = {
  ticksProcessed: number;
  bookUpdates: number;
  trades: HFTScalpTrade[];
  totalPnlBps: number;
  halted: boolean;
  haltReason?: string;
  avgLatencyMs: number;
};
