import type { PortfolioState } from "./types";
import type { TradeJournal } from "./trade-journal";
import {
  buyFillPrice,
  feeOnNotional,
  maxAffordableBuyNotional,
  sellFillPrice,
} from "./trading-friction";

export type RebalanceResult = {
  positionsBefore: Record<string, number>;
  positionsAfter: Record<string, number>;
  totalFeesPaid: number;
};

export type ExecutionFriction = {
  /** Daily engine: ordini a mercato → taker fee (bps). */
  takerFeeBps?: number;
  slippageBps?: number;
  symbolSlippageBps?: Record<string, number>;
};

function frictionRates(friction: ExecutionFriction): { takerFeeBps: number; defaultSlipBps: number } {
  return {
    takerFeeBps: friction.takerFeeBps ?? 0,
    defaultSlipBps: friction.slippageBps ?? 0,
  };
}

function slippageForSymbol(symbol: string, friction: ExecutionFriction, defaultSlipBps: number): number {
  const sym = symbol.toUpperCase();
  return friction.symbolSlippageBps?.[sym] ?? defaultSlipBps;
}

/**
 * Ribilanica il portafoglio verso i pesi target (100% investito se somma pesi = 1).
 * Vende prima, poi compra. Fill a prezzi EOD con slippage; fee sul notional.
 */
export function executeRebalance(
  state: PortfolioState,
  _dayIndex: number,
  prices: Record<string, number>,
  targetWeights: Record<string, number>,
  reason: string,
  journal: TradeJournal,
  friction: ExecutionFriction = {},
): RebalanceResult {
  const { takerFeeBps, defaultSlipBps } = frictionRates(friction);
  const date = state.currentDate;
  const pv = state.portfolioValue;
  const positionsBefore = { ...state.positions };
  let totalFeesPaid = 0;

  const symbols = new Set([
    ...Object.keys(state.positions),
    ...Object.keys(targetWeights),
  ]);

  for (const sym of symbols) {
    const close = prices[sym];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    const slipBps = slippageForSymbol(sym, friction, defaultSlipBps);
    const fillPx = sellFillPrice(close, slipBps);
    const targetW = targetWeights[sym] ?? 0;
    const targetValue = pv * targetW;
    const currentQty = state.positions[sym] ?? 0;
    const currentValue = currentQty * close;
    const deltaValue = targetValue - currentValue;

    if (Math.abs(deltaValue) < 1e-9) continue;

    const wasHeld = currentQty > 1e-12;
    if (deltaValue < 0) {
      const sellQty = Math.min(currentQty, -deltaValue / fillPx);
      const notional = sellQty * fillPx;
      const fee = feeOnNotional(notional, takerFeeBps);
      totalFeesPaid += fee;
      state.positions[sym] = currentQty - sellQty;
      if (state.positions[sym] < 1e-12) {
        delete state.positions[sym];
        delete state.entryPrices[sym];
      }
      state.cash += notional - fee;
      const nowHeld = (state.positions[sym] ?? 0) > 1e-12;
      journal.syncSymbol(
        sym,
        wasHeld,
        nowHeld,
        date,
        fillPx,
        state.portfolioValue,
        reason,
        reason,
        fee,
      );
    }
  }

  state.portfolioValue =
    state.cash +
    Object.entries(state.positions).reduce((s, [sym, q]) => s + q * (prices[sym] ?? 0), 0);

  for (const sym of symbols) {
    const close = prices[sym];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    const slipBps = slippageForSymbol(sym, friction, defaultSlipBps);
    const fillPx = buyFillPrice(close, slipBps);
    const targetW = targetWeights[sym] ?? 0;
    const targetValue = state.portfolioValue * targetW;
    const currentQty = state.positions[sym] ?? 0;
    const currentValue = currentQty * close;
    const deltaValue = targetValue - currentValue;
    if (deltaValue <= 1e-9) continue;
    const wasHeld = currentQty > 1e-12;
    let notional = deltaValue;
    const maxNotional = maxAffordableBuyNotional(state.cash, takerFeeBps);
    notional = Math.min(notional, maxNotional);
    if (notional <= 1e-9) continue;
    const fee = feeOnNotional(notional, takerFeeBps);
    const totalCost = notional + fee;
    totalFeesPaid += fee;
    state.cash -= totalCost;
    const buyQty = notional / fillPx;
    const oldQty = currentQty;
    const newQty = oldQty + buyQty;
    state.positions[sym] = newQty;
    state.entryPrices[sym] =
      oldQty > 0 ? ((state.entryPrices[sym] ?? fillPx) * oldQty + fillPx * buyQty) / newQty : fillPx;
    journal.syncSymbol(
      sym,
      wasHeld,
      true,
      date,
      fillPx,
      state.portfolioValue,
      reason,
      reason,
      fee,
    );
  }

  state.portfolioValue =
    state.cash +
    Object.entries(state.positions).reduce((s, [sym, q]) => s + q * (prices[sym] ?? 0), 0);

  return { positionsBefore, positionsAfter: { ...state.positions }, totalFeesPaid };
}

/** Liquidazione forzata di tutto il portafoglio. Se `haltPortfolio`, imposta isHalted (sospensione risk mensile). */
export function executeForcedLiquidation(
  state: PortfolioState,
  prices: Record<string, number>,
  reason: string,
  journal: TradeJournal,
  friction: ExecutionFriction = {},
  haltPortfolio = false,
): number {
  let totalFeesPaid = 0;
  for (const sym of Object.keys({ ...state.positions })) {
    totalFeesPaid += closePosition(state, sym, prices, reason, journal, friction);
  }
  state.portfolioValue = state.cash;
  if (haltPortfolio) {
    state.isHalted = true;
    state.safeMode = true;
  }
  return totalFeesPaid;
}

/** Chiude una singola posizione (stop-loss). Non imposta isHalted. */
export function closePosition(
  state: PortfolioState,
  symbol: string,
  prices: Record<string, number>,
  reason: string,
  journal: TradeJournal,
  friction: ExecutionFriction = {},
): number {
  const { takerFeeBps, defaultSlipBps } = frictionRates(friction);
  const sym = symbol.toUpperCase();
  const qty = state.positions[sym] ?? 0;
  if (qty <= 1e-12) return 0;
  const close = prices[sym] ?? 0;
  const slipBps = slippageForSymbol(sym, friction, defaultSlipBps);
  const fillPx = sellFillPrice(close, slipBps);
  const wasHeld = true;
  const notional = qty * fillPx;
  const fee = feeOnNotional(notional, takerFeeBps);
  state.cash += notional - fee;
  delete state.positions[sym];
  delete state.entryPrices[sym];
  journal.syncSymbol(sym, wasHeld, false, state.currentDate, fillPx, state.cash, reason, reason, fee);
  state.portfolioValue =
    state.cash +
    Object.entries(state.positions).reduce((s, [s2, q]) => s + q * (prices[s2] ?? 0), 0);
  return fee;
}
