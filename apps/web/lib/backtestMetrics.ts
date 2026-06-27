/**
 * Formattazione e etichette per metriche backtest (metrics.json).
 * Convenzione backend: total_return, max_drawdown, win_rate sono frazioni (0.03 = 3%).
 * Sharpe/Sortino/Calmar sono rapporti adimensionali, non percentuali.
 */

const PERCENT_FRACTION_KEYS = new Set([
  "total_return",
  "max_drawdown",
  "win_rate",
  "gross_exposure_cap",
]);

function isPercentFractionKey(key: string): boolean {
  const k = key.toLowerCase();
  if (PERCENT_FRACTION_KEYS.has(k)) return true;
  if (k.endsWith("_frac") || k.includes("cost_frac")) return true;
  return false;
}

function isRatioMetricKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "sharpe_ratio" ||
    k === "sortino_ratio" ||
    k === "calmar_ratio" ||
    k === "profit_factor" ||
    k.includes("sharpe_ratio") ||
    k.includes("sortino")
  );
}

function isIntegerMetricKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k === "num_trades" ||
    k === "num_orders" ||
    k === "symbols_traded" ||
    k === "max_consecutive_loss_bars"
  );
}

function isCurrencyLikeKey(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("equity") || k === "net_pnl" || k.endsWith("_pnl");
}

/** Ordine consigliato per la tabella metriche (engine). */
export const ENGINE_METRIC_KEY_ORDER: string[] = [
  "total_return",
  "net_pnl",
  "initial_equity",
  "final_equity",
  "max_drawdown",
  "sharpe_ratio",
  "sortino_ratio",
  "calmar_ratio",
  "profit_factor",
  "win_rate",
  "num_trades",
  "num_orders",
  "symbols_traded",
  "avg_executed_turnover",
  "gross_exposure_cap",
  "sharpe_annualization_bars_per_year",
  "max_consecutive_loss_bars",
  "execution_micro_total_cost_frac",
  "execution_ohlcv_baseline_total_cost_frac",
  "execution_micro_minus_ohlcv_cost_frac",
];

export function metricLabelIt(key: string): string {
  const labels: Record<string, string> = {
    total_return: "Rendimento totale (portafoglio)",
    net_pnl: "PnL netto",
    initial_equity: "Capitale iniziale",
    final_equity: "Capitale finale",
    max_drawdown: "Drawdown massimo",
    sharpe_ratio: "Sharpe (annualizzato)",
    sortino_ratio: "Sortino (annualizzato)",
    calmar_ratio: "Calmar",
    profit_factor: "Profit factor",
    win_rate: "Win rate (trade)",
    num_trades: "N. trade",
    num_orders: "N. ordini",
    symbols_traded: "Simboli usati",
    avg_executed_turnover: "Turnover medio (eseguito)",
    gross_exposure_cap: "Esposizione lorda max (cap)",
    sharpe_annualization_bars_per_year: "Barre/anno (annualizzazione Sharpe)",
    max_consecutive_loss_bars: "Max barre consecutive in perdita",
    execution_micro_total_cost_frac: "Costo esecuzione (micro, fraz. equity)",
    execution_ohlcv_baseline_total_cost_frac: "Costo esecuzione (baseline OHLCV)",
    execution_micro_minus_ohlcv_cost_frac: "Δ costo micro − baseline",
  };
  return labels[key] ?? key.replace(/_/g, " ");
}

/**
 * Formatta un valore numerico da metrics.json in base alla chiave.
 */
export function formatEngineMetricValue(key: string, value: number): string {
  if (!Number.isFinite(value)) return "—";
  const k = key.toLowerCase();

  if (isPercentFractionKey(k)) {
    return `${(value * 100).toFixed(2)}%`;
  }

  if (isIntegerMetricKey(k)) {
    return Math.round(value).toLocaleString("it-IT");
  }

  if (isRatioMetricKey(k)) {
    return value.toFixed(2);
  }

  if (k.includes("bars_per_year") || k.includes("annualization_bars")) {
    return value.toLocaleString("it-IT", { maximumFractionDigits: 1 });
  }

  if (isCurrencyLikeKey(k)) {
    return value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Turnover medio: non è sempre 0–1; mostra come numero compatto
  if (k === "avg_executed_turnover") {
    return value.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  }

  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
  }
  return value.toFixed(4);
}

function sortMetricKeys(keys: string[]): string[] {
  const order = new Map(ENGINE_METRIC_KEY_ORDER.map((k, i) => [k, i]));
  return [...keys].sort((a, b) => {
    const ia = order.get(a) ?? 999;
    const ib = order.get(b) ?? 999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  });
}

export function engineMetricsRowsFromRecord(m: Record<string, unknown> | null): [string, string][] {
  if (!m) return [];
  const numericKeys = Object.entries(m).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v as number)
  ) as [string, number][];
  const sorted = sortMetricKeys(numericKeys.map(([k]) => k));
  const map = new Map(numericKeys);
  return sorted.map((k) => [metricLabelIt(k), formatEngineMetricValue(k, map.get(k) as number)]);
}

/** Come engineMetricsRowsFromRecord, ma include anche valori non numerici (stringa/JSON). */
export function metricsEntriesFromJson(m: Record<string, unknown> | null): [string, string][] {
  if (!m) return [];
  const numeric: [string, number][] = [];
  const other: [string, string][] = [];
  for (const [k, v] of Object.entries(m)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      numeric.push([k, v]);
    } else if (v !== null && typeof v === "object") {
      const s = JSON.stringify(v);
      other.push([metricLabelIt(k), s.length > 160 ? `${s.slice(0, 160)}…` : s]);
    } else {
      other.push([metricLabelIt(k), String(v ?? "—")]);
    }
  }
  const sortedNum = sortMetricKeys(numeric.map(([k]) => k));
  const nmap = new Map(numeric);
  const rows: [string, string][] = sortedNum.map((k) => [
    metricLabelIt(k),
    formatEngineMetricValue(k, nmap.get(k) as number),
  ]);
  other.sort((a, b) => a[0].localeCompare(b[0]));
  return [...rows, ...other];
}

/** Testo esplicativo per la tab trade (PnL% vs rendimento portafoglio). */
export const TRADE_PNL_PCT_HINT_IT =
  "PnL % = movimento prezzo sul titolo per il trade (non è il rendimento del portafoglio). PnL € = pnl_pct × capitale iniziale × peso (etichetta per trade, non somma al netto).";

/** Riepilogo periodo grafico (frazioni 0–1). */
export function formatRangePercentFraction(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}
