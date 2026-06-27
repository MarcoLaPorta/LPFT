/**
 * Client Tier 1 Phase 2 — validazione quant Python (CPCV, DSR, FFD, MC 10k, CVaR).
 * Non blocca il thread Node: fetch HTTP verso LPFT API (:8000).
 */

import { getApiBase } from "./api";

export type Tier1ValidationResult = {
  version: string;
  n_observations: number;
  sharpe: number;
  dsr: {
    observed_sharpe: number;
    dsr: number;
    expected_max_sharpe: number;
    n_observations: number;
    n_trials: number;
    skew: number;
    kurtosis: number;
  };
  cvar: {
    historical: { var: number; cvar: number; alpha: number; n: number };
    monte_carlo: { var_95: number; cvar_95: number };
  };
  cpcv: {
    n_folds: number;
    sharpe_mean: number;
    sharpe_std: number;
    sharpe_min: number;
    sharpe_max: number;
    fold_sharpes: number[];
  };
  fractional_diff: {
    d: number;
    n_weights: number;
    n_obs: number;
    last: number | null;
    std: number | null;
  };
  monte_carlo: {
    n_paths: number;
    horizon_days: number;
    terminal_return_p5: number;
    terminal_return_p50: number;
    terminal_return_p95: number;
    terminal_return_mean: number;
    var_95: number;
    cvar_95: number;
  };
};

export type Tier1ValidateOptions = {
  equity?: number[];
  returns?: number[];
  n_trials?: number;
  mc_paths?: number;
  mc_horizon_days?: number;
  timeoutMs?: number;
};

function serverApiBase(): string {
  return (
    process.env.LPFT_API_INTERNAL_BASE?.trim() ||
    process.env.NEXT_PUBLIC_LPFT_API_BASE?.trim() ||
    "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

/** Chiamata server-side (route API / tool chat). */
export async function fetchTier1Validation(
  opts: Tier1ValidateOptions,
): Promise<Tier1ValidationResult | null> {
  const base = typeof window === "undefined" ? serverApiBase() : getApiBase();
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/quant/tier1/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        equity: opts.equity,
        returns: opts.returns,
        n_trials: opts.n_trials ?? 1,
        mc_paths: opts.mc_paths ?? 10_000,
        mc_horizon_days: opts.mc_horizon_days ?? 30,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Tier1ValidationResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Equity curve → validazione Tier 1 (best-effort). */
export async function validateEquityCurveTier1(
  equity: number[],
  options?: { n_trials?: number; mc_horizon_days?: number },
): Promise<Tier1ValidationResult | null> {
  const clean = equity.filter((x) => Number.isFinite(x) && x > 0);
  if (clean.length < 12) return null;
  return fetchTier1Validation({
    equity: clean,
    n_trials: options?.n_trials ?? 1,
    mc_horizon_days: options?.mc_horizon_days ?? 30,
    mc_paths: 10_000,
  });
}
