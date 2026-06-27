import type { PortfolioState } from "./types";

export function createInitialPortfolio(initialCash = 1): PortfolioState {
  return {
    currentDate: "",
    cash: initialCash,
    positions: {},
    portfolioValue: initialCash,
    highWaterMark: initialCash,
    safeMode: false,
    isHalted: false,
    entryPrices: {},
  };
}

/** Mark-to-market su adjClose del giorno corrente. */
export function markToMarket(
  state: PortfolioState,
  prices: Record<string, number>,
): number {
  let holdings = 0;
  for (const [sym, qty] of Object.entries(state.positions)) {
    if (qty <= 0) continue;
    const px = prices[sym];
    if (px != null && Number.isFinite(px)) holdings += qty * px;
  }
  return state.cash + holdings;
}

/**
 * Primo tick valido: ancora HWM a 0/NaN → fissalo all'equity corrente (mai lasciare HWM a zero).
 */
export function seedHighWaterMarkIfNeeded(state: PortfolioState): void {
  const pv = state.portfolioValue;
  if (!Number.isFinite(pv) || pv <= 0) return;
  if (!Number.isFinite(state.highWaterMark) || state.highWaterMark <= 0) {
    state.highWaterMark = pv;
  }
}

export function updateHighWaterMark(state: PortfolioState): void {
  const pv = state.portfolioValue;
  if (!Number.isFinite(pv) || pv <= 0) return;
  seedHighWaterMarkIfNeeded(state);
  if (pv > state.highWaterMark) {
    state.highWaterMark = pv;
  }
}

/**
 * Fine sospensione risk (halt mensile): riabilita segnali e ribasizza HWM se l'equity
 * è sotto il picco precedente, evitando drawdown ereditato dal periodo di halt.
 */
export function releaseMonthlyRiskHalt(state: PortfolioState): void {
  if (!state.isHalted) return;
  state.isHalted = false;
  state.safeMode = false;
  const pv = state.portfolioValue;
  if (Number.isFinite(pv) && pv > 0 && state.highWaterMark > pv) {
    state.highWaterMark = pv;
  }
}
