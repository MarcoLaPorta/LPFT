import type { StrategyAnalysisSnapshot } from "./afx-analysis-types";

export type RiskCapsView = NonNullable<StrategyAnalysisSnapshot["riskCapsApplied"]>;

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** Accetta riskManagement / risk_management con chiavi camelCase o snake_case. */
export function parseRiskCaps(raw: unknown): RiskCapsView | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const maxDrawdownLimit =
    num(o.maxDrawdownLimit) ??
    num(o.max_drawdown_limit) ??
    num(o.maxDrawdown) ??
    num(o.max_drawdown);
  const stopLossPercentage =
    num(o.stopLossPercentage) ??
    num(o.stop_loss_percentage) ??
    num(o.stopLoss) ??
    num(o.stop_loss);
  const trailingStop = bool(o.trailingStop) ?? bool(o.trailing_stop);
  const makerFeeBps = num(o.makerFeeBps) ?? num(o.maker_fee_bps);
  const takerFeeBps = num(o.takerFeeBps) ?? num(o.taker_fee_bps);
  if (maxDrawdownLimit == null || stopLossPercentage == null) return undefined;
  return {
    maxDrawdownLimit,
    stopLossPercentage,
    trailingStop: trailingStop ?? false,
    ...(makerFeeBps != null ? { makerFeeBps } : {}),
    ...(takerFeeBps != null ? { takerFeeBps } : {}),
  };
}

/** Preferisce riskCapsApplied salvato; fallback su compiledStrategy.riskManagement. */
export function resolveRiskCapsApplied(
  riskCapsApplied: unknown,
  compiledStrategy?: unknown,
): RiskCapsView | undefined {
  const direct = parseRiskCaps(riskCapsApplied);
  if (direct) return direct;
  if (!compiledStrategy || typeof compiledStrategy !== "object") return undefined;
  const cs = compiledStrategy as Record<string, unknown>;
  return (
    parseRiskCaps(cs.riskManagement) ??
    parseRiskCaps(cs.risk_management) ??
    parseRiskCaps(cs.risk)
  );
}

export function riskCapsFromQuantInput(risk: {
  maxDrawdownLimit: number;
  stopLossPercentage: number;
  trailingStop: boolean;
  makerFeeBps?: number;
  takerFeeBps?: number;
}): RiskCapsView {
  return {
    maxDrawdownLimit: risk.maxDrawdownLimit,
    stopLossPercentage: risk.stopLossPercentage,
    trailingStop: risk.trailingStop,
    ...(typeof risk.makerFeeBps === "number" ? { makerFeeBps: risk.makerFeeBps } : {}),
    ...(typeof risk.takerFeeBps === "number" ? { takerFeeBps: risk.takerFeeBps } : {}),
  };
}
