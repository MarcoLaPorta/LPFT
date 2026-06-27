import type { EventDrivenStrategyConfig, PortfolioState } from "./types";

export type RiskEvaluation =
  | { kind: "none" }
  | { kind: "halt_portfolio"; reason: string }
  | { kind: "close_position"; symbol: string; reason: string };

function positionReturn(entryPrice: number, currentPrice: number): number {
  if (entryPrice <= 0) return 0;
  return currentPrice / entryPrice - 1;
}

/**
 * Drawdown vs HWM. `null` se HWM o equity non validi — il chiamante deve saltare il circuit breaker.
 */
export function computePortfolioDrawdown(state: PortfolioState): number | null {
  const hwm = state.highWaterMark;
  const pv = state.portfolioValue;
  if (!Number.isFinite(hwm) || !Number.isFinite(pv) || hwm <= 0) return null;
  const dd = (pv - hwm) / hwm;
  return Number.isFinite(dd) ? dd : null;
}

/**
 * FASE B — risk giornaliero (risoluzione daily, non intraday).
 * Max DD → halt_portfolio (sospensione fino al reset mensile/trimestrale in Fase C).
 * Stop-loss → solo la posizione in violazione (rotazione consentita al ribilanciamento).
 */
export function evaluatePortfolioRisk(
  state: PortfolioState,
  prices: Record<string, number>,
  config: EventDrivenStrategyConfig,
): RiskEvaluation {
  const tag = config.sourceSignal;
  const dd = computePortfolioDrawdown(state);

  if (
    dd != null &&
    config.risk.liquidateToBaseOnMaxDrawdown &&
    dd <= -config.risk.maxDrawdownLimit
  ) {
    return {
      kind: "halt_portfolio",
      reason: `${tag}:RISK_LIQUIDATION_MAX_DD(dd=${(dd * 100).toFixed(2)}%,lim=${(config.risk.maxDrawdownLimit * 100).toFixed(0)}%)`,
    };
  }

  for (const [sym, qty] of Object.entries(state.positions)) {
    if (qty <= 0) continue;
    const entry = state.entryPrices[sym];
    const px = prices[sym];
    if (entry == null || px == null) continue;
    const ret = positionReturn(entry, px);
    const trailRef = config.risk.trailingStop ? Math.max(entry, px) : entry;
    const trailRet = trailRef > 0 ? px / trailRef - 1 : ret;
    const loss = config.risk.trailingStop ? trailRet : ret;
    if (loss <= -config.risk.stopLossPercentage) {
      return {
        kind: "close_position",
        symbol: sym,
        reason: `${tag}:RISK_LIQUIDATION_STOP_LOSS(${sym},pnl=${(ret * 100).toFixed(2)}%)`,
      };
    }
  }

  return { kind: "none" };
}
