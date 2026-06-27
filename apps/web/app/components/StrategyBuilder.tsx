"use client";

import { useId, type ReactNode } from "react";

import type { StrategySpec } from "../../lib/api";

/** @deprecated Usa `FiduciaryChat` nella home: `/` */

/** Form configurazione strategia → prompt strutturato per il planner (italiano). */
export type StrategyBuilderFormState = {
  ticker: string;
  /** Simboli aggiuntivi separati da virgola (portfolio multi-ticker). */
  secondarySymbols: string;
  market: "equity" | "etf" | "crypto";
  barTimeframe: "1m" | "5m" | "15m" | "30m" | "1h" | "1d";
  edge: "trend" | "mean_reversion" | "breakout" | "hybrid";
  horizon: "intraday" | "swing" | "daily";
  /** Suggerimento tipo strategia LPFT / codice custom */
  strategyKindHint:
    | "auto"
    | "sma_crossover"
    | "ema_crossover"
    | "rsi"
    | "macd"
    | "bollinger"
    | "breakout"
    | "mean_reversion"
    | "python";
  smaFast: number;
  smaSlow: number;
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStd: number;
  breakoutLookback: number;
  breakoutExitLookback: number;
  mrPeriod: number;
  mrEntryZ: number;
  mrExitZ: number;
  riskProfile: "conservative" | "balanced" | "aggressive";
  maxPositionPct: number;
  maxGrossExposure: number;
  feeBps: number;
  slippageBps: number;
  stopLossPct: string;
  takeProfitPct: string;
  trailingStopPct: string;
  positionMode: "long_only" | "long_short";
  rebalance: "equal_weight" | "dynamic";
  entryTiming: "next_bar_open" | "bar_close";
  assetClass: "auto" | "equity" | "etf" | "crypto";
  providerPreference: "auto" | "yahoo" | "stooq";
  qualityPolicy: "strict_gate" | "quality_labels" | "best_effort";
  freshnessRequirement: "relaxed" | "standard" | "strict";
  coverageRequirement: "relaxed" | "standard" | "strict";
  corporateActionsRequired: boolean;
  dataNotes: string;
  historyPeriod: "1m" | "3m" | "6m" | "1y" | "2y" | "5y";
  runBacktest: boolean;
};

export const DEFAULT_STRATEGY_BUILDER_FORM: StrategyBuilderFormState = {
  ticker: "MSFT",
  secondarySymbols: "",
  market: "equity",
  barTimeframe: "1d",
  edge: "mean_reversion",
  horizon: "daily",
  strategyKindHint: "auto",
  smaFast: 10,
  smaSlow: 50,
  emaFast: 12,
  emaSlow: 26,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bollingerPeriod: 20,
  bollingerStd: 2,
  breakoutLookback: 20,
  breakoutExitLookback: 10,
  mrPeriod: 20,
  mrEntryZ: 2,
  mrExitZ: 0.5,
  riskProfile: "balanced",
  maxPositionPct: 100,
  maxGrossExposure: 100,
  feeBps: 5,
  slippageBps: 2,
  stopLossPct: "",
  takeProfitPct: "",
  trailingStopPct: "",
  positionMode: "long_only",
  rebalance: "equal_weight",
  entryTiming: "next_bar_open",
  assetClass: "auto",
  providerPreference: "auto",
  qualityPolicy: "best_effort",
  freshnessRequirement: "standard",
  coverageRequirement: "standard",
  corporateActionsRequired: true,
  dataNotes: "",
  historyPeriod: "5y",
  runBacktest: true,
};

const KIND_LABELS: Record<StrategyBuilderFormState["strategyKindHint"], string> = {
  auto: "Lascia decidere al motore (auto)",
  sma_crossover: "SMA crossover",
  ema_crossover: "EMA crossover",
  rsi: "RSI",
  macd: "MACD",
  bollinger: "Bollinger",
  breakout: "Breakout",
  mean_reversion: "Mean reversion (z-score)",
  python: "Python custom (logica a target position)",
};

const BAR_TF = new Set<string>(["1m", "5m", "15m", "30m", "1h", "1d"]);
const HISTORY = new Set<string>(["1m", "3m", "6m", "1y", "2y", "5y"]);

function n(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function optPctStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "number" ? String(v) : String(v);
}

/**
 * Mappa l’ultimo StrategySpec generato in chat → stato form (per modificare e rigenerare).
 */
export function strategySpecToFormState(spec: StrategySpec): StrategyBuilderFormState {
  const f: StrategyBuilderFormState = { ...DEFAULT_STRATEGY_BUILDER_FORM };
  const syms = spec.universe?.symbols ?? [];
  if (syms[0]) f.ticker = String(syms[0]).toUpperCase();
  if (syms.length > 1) f.secondarySymbols = syms.slice(1).map((s) => String(s).toUpperCase()).join(", ");

  const tf = spec.universe?.timeframe;
  if (tf && BAR_TF.has(tf)) f.barTimeframe = tf as StrategyBuilderFormState["barTimeframe"];

  const kind = (spec.kind ?? "").toString().toLowerCase();
  if (kind in KIND_LABELS) {
    f.strategyKindHint = kind as StrategyBuilderFormState["strategyKindHint"];
  }

  const p = (spec.params ?? {}) as Record<string, unknown>;
  const fast = n(p.fast);
  const slow = n(p.slow);
  if (kind === "sma_crossover" || kind === "ema_crossover") {
    if (fast !== undefined) {
      if (kind === "sma_crossover") f.smaFast = Math.max(1, Math.min(200, Math.round(fast)));
      else f.emaFast = Math.max(1, Math.min(200, Math.round(fast)));
    }
    if (slow !== undefined) {
      if (kind === "sma_crossover") f.smaSlow = Math.max(1, Math.min(200, Math.round(slow)));
      else f.emaSlow = Math.max(1, Math.min(200, Math.round(slow)));
    }
  }
  if (kind === "rsi") {
    const period = n(p.period);
    const ob = n(p.overbought);
    const os = n(p.oversold);
    if (period !== undefined) f.rsiPeriod = Math.max(2, Math.min(100, Math.round(period)));
    if (ob !== undefined) f.rsiOverbought = Math.max(50, Math.min(100, ob));
    if (os !== undefined) f.rsiOversold = Math.max(0, Math.min(50, os));
  }
  if (kind === "macd") {
    const mf = n(p.fast);
    const ms = n(p.slow);
    const sig = n(p.signal);
    if (mf !== undefined) f.macdFast = Math.max(1, Math.min(50, Math.round(mf)));
    if (ms !== undefined) f.macdSlow = Math.max(1, Math.min(200, Math.round(ms)));
    if (sig !== undefined) f.macdSignal = Math.max(1, Math.min(50, Math.round(sig)));
  }
  if (kind === "bollinger") {
    const period = n(p.period);
    const std = n(p.std);
    if (period !== undefined) f.bollingerPeriod = Math.max(2, Math.min(200, Math.round(period)));
    if (std !== undefined) f.bollingerStd = Math.max(0.5, Math.min(5, std));
  }
  if (kind === "breakout") {
    const lb = n(p.lookback);
    const el = n(p.exit_lookback);
    if (lb !== undefined) f.breakoutLookback = Math.max(2, Math.min(250, Math.round(lb)));
    if (el !== undefined) f.breakoutExitLookback = Math.max(2, Math.min(250, Math.round(el)));
  }
  if (kind === "mean_reversion") {
    const period = n(p.period);
    const ez = n(p.entry_z);
    const xz = n(p.exit_z);
    if (period !== undefined) f.mrPeriod = Math.max(5, Math.min(250, Math.round(period)));
    if (ez !== undefined) f.mrEntryZ = Math.max(0.5, Math.min(5, ez));
    if (xz !== undefined) f.mrExitZ = Math.max(0, Math.min(4, xz));
  }

  // Edge (euristica da kind)
  if (kind === "mean_reversion") f.edge = "mean_reversion";
  else if (kind === "breakout") f.edge = "breakout";
  else if (["sma_crossover", "ema_crossover", "rsi", "macd"].includes(kind)) f.edge = "trend";
  else f.edge = "hybrid";

  // Orizzonte da timeframe barre
  if (f.barTimeframe === "1d") f.horizon = "daily";
  else if (f.barTimeframe === "1h" || f.barTimeframe === "30m") f.horizon = "swing";
  else f.horizon = "intraday";

  const r = spec.risk;
  if (r?.max_position_pct != null) {
    const pct = Number(r.max_position_pct);
    if (Number.isFinite(pct)) f.maxPositionPct = Math.max(1, Math.min(100, Math.round(pct * 100)));
  }
  if (r?.max_gross_exposure != null) {
    const g = Number(r.max_gross_exposure);
    if (Number.isFinite(g)) f.maxGrossExposure = Math.max(1, Math.min(200, Math.round(g * 100)));
  }
  if (r?.fee_bps != null) f.feeBps = Math.max(0, Math.min(100, Math.round(Number(r.fee_bps))));
  if (r?.slippage_bps != null) f.slippageBps = Math.max(0, Math.min(100, Math.round(Number(r.slippage_bps))));
  f.stopLossPct = optPctStr(r?.stop_loss_pct);
  f.takeProfitPct = optPctStr(r?.take_profit_pct);
  f.trailingStopPct = optPctStr(r?.trailing_stop_pct);

  if (r?.max_position_pct != null && Number.isFinite(Number(r.max_position_pct))) {
    const mp = Number(r.max_position_pct);
    if (mp <= 0.35) f.riskProfile = "conservative";
    else if (mp >= 0.75) f.riskProfile = "aggressive";
    else f.riskProfile = "balanced";
  }

  const ex = spec.execution;
  if (ex?.position_mode === "long_only" || ex?.position_mode === "long_short") f.positionMode = ex.position_mode;
  if (ex?.rebalance === "equal_weight" || ex?.rebalance === "dynamic") f.rebalance = ex.rebalance;
  if (ex?.entry_timing === "next_bar_open" || ex?.entry_timing === "bar_close") f.entryTiming = ex.entry_timing;

  const d = spec.data;
  if (d?.asset_class === "equity" || d?.asset_class === "etf" || d?.asset_class === "crypto") {
    f.assetClass = d.asset_class;
    if (d.asset_class === "crypto") f.market = "crypto";
    else if (d.asset_class === "etf") f.market = "etf";
    else if (d.asset_class === "equity") f.market = "equity";
  }
  if (d?.provider_preference === "auto" || d?.provider_preference === "yahoo" || d?.provider_preference === "stooq") {
    f.providerPreference = d.provider_preference;
  }
  if (d?.quality_policy === "strict_gate" || d?.quality_policy === "quality_labels" || d?.quality_policy === "best_effort") {
    f.qualityPolicy = d.quality_policy;
  }
  if (d?.freshness_requirement === "relaxed" || d?.freshness_requirement === "standard" || d?.freshness_requirement === "strict") {
    f.freshnessRequirement = d.freshness_requirement;
  }
  if (d?.coverage_requirement === "relaxed" || d?.coverage_requirement === "standard" || d?.coverage_requirement === "strict") {
    f.coverageRequirement = d.coverage_requirement;
  }
  if (typeof d?.corporate_actions_required === "boolean") f.corporateActionsRequired = d.corporate_actions_required;
  if (typeof d?.notes === "string" && d.notes.trim()) f.dataNotes = d.notes.trim();
  const hp = d?.history_period;
  if (hp && HISTORY.has(hp)) f.historyPeriod = hp as StrategyBuilderFormState["historyPeriod"];

  return f;
}

export function buildStrategyPromptFromForm(f: StrategyBuilderFormState): string {
  const sym = (f.ticker.trim().toUpperCase() || "MSFT").replace(/^[^A-Z0-9.-]+/i, "");
  const extras = f.secondarySymbols
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const marketLine =
    f.market === "equity"
      ? "azioni USA molto liquide (large cap)"
      : f.market === "etf"
        ? "ETF liquidi (broad market o settoriale)"
        : "crypto major";
  const edgeLine =
    f.edge === "trend"
      ? "trend / momentum"
      : f.edge === "mean_reversion"
        ? "mean reversion"
        : f.edge === "breakout"
          ? "breakout"
          : "ibrida conservativa (meno overfit)";
  const horizonLine =
    f.horizon === "intraday"
      ? "intraday (barre corte, contesto chiaro)"
      : f.horizon === "swing"
        ? "swing (pochi giorni)"
        : "daily / position";
  const riskLine =
    f.riskProfile === "conservative"
      ? "conservativo"
      : f.riskProfile === "balanced"
        ? "bilanciato"
        : "aggressivo";

  const kindHint =
    f.strategyKindHint === "auto"
      ? "nessun vincolo rigido sul kind: scegli il più adatto all’edge."
      : `preferenza kind LPFT: ${KIND_LABELS[f.strategyKindHint]}.`;

  const paramBlock = [
    `Parametri indicatore suggeriti (adatta se scegli kind corrispondente):`,
    `- Barra OHLCV (universe.timeframe): ${f.barTimeframe}`,
    `- SMA: fast ${f.smaFast}, slow ${f.smaSlow}`,
    `- EMA: fast ${f.emaFast}, slow ${f.emaSlow}`,
    `- RSI: period ${f.rsiPeriod}, overbought ${f.rsiOverbought}, oversold ${f.rsiOversold}`,
    `- MACD: fast ${f.macdFast}, slow ${f.macdSlow}, signal ${f.macdSignal}`,
    `- Bollinger: period ${f.bollingerPeriod}, std ${f.bollingerStd}`,
    `- Breakout: lookback ${f.breakoutLookback}, exit lookback ${f.breakoutExitLookback}`,
    `- Mean reversion: period ${f.mrPeriod}, entry_z ${f.mrEntryZ}, exit_z ${f.mrExitZ}`,
  ].join("\n");

  const riskBlock = [
    `Rischio e costi (risk):`,
    `- max_position_pct: ${(f.maxPositionPct / 100).toFixed(2)} (utente ha impostato ${f.maxPositionPct}% come tetto esposizione singola — normalizza in 0–1 nello spec)`,
    `- max_gross_exposure: ${(f.maxGrossExposure / 100).toFixed(2)}`,
    `- fee_bps: ${f.feeBps}, slippage_bps: ${f.slippageBps}`,
    f.stopLossPct.trim() ? `- stop_loss_pct: ${f.stopLossPct}` : `- stop_loss_pct: non specificato`,
    f.takeProfitPct.trim() ? `- take_profit_pct: ${f.takeProfitPct}` : `- take_profit_pct: non specificato`,
    f.trailingStopPct.trim() ? `- trailing_stop_pct: ${f.trailingStopPct}` : `- trailing_stop_pct: non specificato`,
  ].join("\n");

  const execBlock = [
    `Esecuzione:`,
    `- position_mode: ${f.positionMode}`,
    `- rebalance: ${f.rebalance}`,
    `- entry_timing: ${f.entryTiming}`,
  ].join("\n");

  const dataBlock = [
    `Dati (data):`,
    `- asset_class: ${f.assetClass}`,
    `- provider_preference: ${f.providerPreference}`,
    `- quality_policy: ${f.qualityPolicy}`,
    `- freshness_requirement: ${f.freshnessRequirement}`,
    `- coverage_requirement: ${f.coverageRequirement}`,
    `- corporate_actions_required: ${f.corporateActionsRequired}`,
    f.dataNotes.trim() ? `- note: ${f.dataNotes.trim()}` : `- note: (nessuna)`,
  ].join("\n");

  const lines = [
    "Genera una nuova strategia con questi vincoli dettagliati:",
    `- Strumento principale: ${sym}`,
    extras.length ? `- Simboli aggiuntivi (portfolio): ${extras.join(", ")}` : `- Portfolio: single-name (solo ${sym})`,
    `- Mercato / universo: ${marketLine}`,
    `- Edge concettuale: ${edgeLine}`,
    `- Orizzonte operativo: ${horizonLine}`,
    `- Profilo di rischio (qualitativo): ${riskLine}`,
    `- ${kindHint}`,
    "",
    paramBlock,
    "",
    riskBlock,
    "",
    execBlock,
    "",
    dataBlock,
    "",
    `- Storico OHLCV per backtest (data.history_period): ${f.historyPeriod}`,
    f.runBacktest
      ? "- Dopo la generazione: eseguire il run storico in coda."
      : "- Dopo la generazione: solo codice e specifica, nessuna esecuzione automatica in coda (no run storico).",
    "",
    "[LPFT form parametri] Il codice Python deve essere generato dall’LLM completo (generate_positions), non da template corti. Il server imposterà kind=python e compilerà tutti i numeri sopra in un’implementazione estesa.",
    "",
    "Procedi con la generazione.",
  ];

  return lines.join("\n");
}

const selectClass =
  "w-full rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[13px] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[rgba(255,255,255,0.12)]";
const inputClass =
  "w-full rounded-xl border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[rgba(255,255,255,0.12)]";
const labelClass = "text-[11px] uppercase tracking-wider text-[var(--text-tertiary)]";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.02)] p-4 md:p-5">
      <h3 className="text-[13px] font-semibold text-[var(--text-primary)] mb-4 pb-2 border-b border-[var(--border-subtle)]">
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={["block space-y-1.5", className ?? ""].join(" ")}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

export function StrategyBuilderFullscreen({
  form,
  setForm,
  onClose,
  onSubmit,
  loading,
  splitLayout,
  editingFromSpec = false,
}: {
  form: StrategyBuilderFormState;
  setForm: React.Dispatch<React.SetStateAction<StrategyBuilderFormState>>;
  onClose: () => void;
  onSubmit: () => void;
  loading: boolean;
  splitLayout: boolean;
  /** True se il form è stato precompilato dall’ultima strategia generata in chat. */
  editingFromSpec?: boolean;
}) {
  const titleId = useId();
  const set = <K extends keyof StrategyBuilderFormState>(key: K, value: StrategyBuilderFormState[K]) =>
    setForm((p) => ({ ...p, [key]: value }));

  return (
    <div
      className="flex flex-col flex-1 min-h-0 bg-[rgba(0,0,0,0.25)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <header className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border-subtle)] bg-[rgba(0,0,0,0.2)]">
        <div>
          <h2 id={titleId} className="text-[16px] font-semibold text-[var(--text-primary)]">
            {editingFromSpec ? "Modifica parametri" : "Configurazione strategia"}
          </h2>
          <p className="text-[12px] text-[var(--text-tertiary)] mt-0.5">
            {editingFromSpec
              ? "Valori caricati dall’ultima strategia generata in chat. Modifica i campi e rigenera con il form strutturato."
              : "Imposta tutti i parametri senza usare la chat. La chat è nascosta finché non chiudi o generi."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[999px] border border-[var(--border-subtle)] px-4 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Torna alla chat
          </button>
          <button
            type="button"
            disabled={loading || !form.ticker.trim()}
            onClick={onSubmit}
            className="btn-primary rounded-[999px] px-5 py-2 text-[12px] font-medium disabled:opacity-50 disabled:pointer-events-none"
          >
            {editingFromSpec ? "Rigenera strategia" : "Genera strategia"}
          </button>
        </div>
      </header>
      <div className="border-b border-[var(--border-subtle)] bg-[rgba(255,204,0,0.08)] px-4 py-2 text-[12px] text-[var(--text-secondary)]">
        Componente deprecato: usa l&apos;assistente sulla home <a href="/" className="underline hover:opacity-90">/</a>.
      </div>

      <div
        className={[
          "flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-5",
          splitLayout ? "max-w-5xl mx-auto w-full" : "max-w-6xl mx-auto w-full",
        ].join(" ")}
      >
        <div className="space-y-5 pb-28">
          <Section title="Strumento e mercato">
            <Field label="Ticker principale">
              <input
                type="text"
                value={form.ticker}
                onChange={(e) => set("ticker", e.target.value)}
                className={inputClass}
                placeholder="es. MSFT, SPY, BTC-USD"
                autoCapitalize="characters"
              />
            </Field>
            <Field label="Altri ticker (opzionale)" className="sm:col-span-2">
              <input
                type="text"
                value={form.secondarySymbols}
                onChange={(e) => set("secondarySymbols", e.target.value)}
                className={inputClass}
                placeholder="Separati da virgola: AAPL, GOOGL"
              />
            </Field>
            <Field label="Mercato">
              <select value={form.market} onChange={(e) => set("market", e.target.value as StrategyBuilderFormState["market"])} className={selectClass}>
                <option value="equity">Azioni USA (liquide)</option>
                <option value="etf">ETF</option>
                <option value="crypto">Crypto</option>
              </select>
            </Field>
            <Field label="Timeframe barre OHLCV">
              <select
                value={form.barTimeframe}
                onChange={(e) => set("barTimeframe", e.target.value as StrategyBuilderFormState["barTimeframe"])}
                className={selectClass}
              >
                <option value="1m">1 minuto</option>
                <option value="5m">5 minuti</option>
                <option value="15m">15 minuti</option>
                <option value="30m">30 minuti</option>
                <option value="1h">1 ora</option>
                <option value="1d">1 giorno</option>
              </select>
            </Field>
          </Section>

          <Section title="Obiettivo e tipo strategia">
            <Field label="Stile (edge)">
              <select value={form.edge} onChange={(e) => set("edge", e.target.value as StrategyBuilderFormState["edge"])} className={selectClass}>
                <option value="trend">Trend / momentum</option>
                <option value="mean_reversion">Mean reversion</option>
                <option value="breakout">Breakout</option>
                <option value="hybrid">Ibrida conservativa</option>
              </select>
            </Field>
            <Field label="Orizzonte">
              <select
                value={form.horizon}
                onChange={(e) => set("horizon", e.target.value as StrategyBuilderFormState["horizon"])}
                className={selectClass}
              >
                <option value="daily">Daily / position</option>
                <option value="swing">Swing (pochi giorni)</option>
                <option value="intraday">Intraday</option>
              </select>
            </Field>
            <Field label="Kind LPFT (suggerimento)" className="sm:col-span-2 lg:col-span-3">
              <select
                value={form.strategyKindHint}
                onChange={(e) =>
                  set("strategyKindHint", e.target.value as StrategyBuilderFormState["strategyKindHint"])
                }
                className={selectClass}
              >
                {(Object.keys(KIND_LABELS) as StrategyBuilderFormState["strategyKindHint"][]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="Parametri indicatore (riferimento per lo spec)">
            <Field label="SMA fast">
              <input type="number" min={1} max={200} value={form.smaFast} onChange={(e) => set("smaFast", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="SMA slow">
              <input type="number" min={1} max={200} value={form.smaSlow} onChange={(e) => set("smaSlow", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="EMA fast">
              <input type="number" min={1} max={200} value={form.emaFast} onChange={(e) => set("emaFast", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="EMA slow">
              <input type="number" min={1} max={200} value={form.emaSlow} onChange={(e) => set("emaSlow", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="RSI period">
              <input type="number" min={2} max={100} value={form.rsiPeriod} onChange={(e) => set("rsiPeriod", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="RSI overbought">
              <input
                type="number"
                min={50}
                max={100}
                value={form.rsiOverbought}
                onChange={(e) => set("rsiOverbought", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="RSI oversold">
              <input type="number" min={0} max={50} value={form.rsiOversold} onChange={(e) => set("rsiOversold", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="MACD fast">
              <input type="number" min={1} max={50} value={form.macdFast} onChange={(e) => set("macdFast", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="MACD slow">
              <input type="number" min={1} max={200} value={form.macdSlow} onChange={(e) => set("macdSlow", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="MACD signal">
              <input type="number" min={1} max={50} value={form.macdSignal} onChange={(e) => set("macdSignal", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="Bollinger period">
              <input
                type="number"
                min={2}
                max={200}
                value={form.bollingerPeriod}
                onChange={(e) => set("bollingerPeriod", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Bollinger σ">
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.1}
                value={form.bollingerStd}
                onChange={(e) => set("bollingerStd", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Breakout lookback">
              <input
                type="number"
                min={2}
                max={250}
                value={form.breakoutLookback}
                onChange={(e) => set("breakoutLookback", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Breakout exit lookback">
              <input
                type="number"
                min={2}
                max={250}
                value={form.breakoutExitLookback}
                onChange={(e) => set("breakoutExitLookback", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="MR period">
              <input type="number" min={5} max={250} value={form.mrPeriod} onChange={(e) => set("mrPeriod", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="MR entry z">
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.1}
                value={form.mrEntryZ}
                onChange={(e) => set("mrEntryZ", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="MR exit z">
              <input
                type="number"
                min={0}
                max={4}
                step={0.1}
                value={form.mrExitZ}
                onChange={(e) => set("mrExitZ", +e.target.value)}
                className={inputClass}
              />
            </Field>
          </Section>

          <Section title="Profilo di rischio e costi">
            <Field label="Profilo (qualitativo)">
              <select
                value={form.riskProfile}
                onChange={(e) => set("riskProfile", e.target.value as StrategyBuilderFormState["riskProfile"])}
                className={selectClass}
              >
                <option value="conservative">Conservativo</option>
                <option value="balanced">Bilanciato</option>
                <option value="aggressive">Aggressivo</option>
              </select>
            </Field>
            <Field label="Max posizione % (0–100)">
              <input
                type="number"
                min={1}
                max={100}
                value={form.maxPositionPct}
                onChange={(e) => set("maxPositionPct", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Esposizione lorda max % (0–200)">
              <input
                type="number"
                min={1}
                max={200}
                value={form.maxGrossExposure}
                onChange={(e) => set("maxGrossExposure", +e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Commissioni (bps)">
              <input type="number" min={0} max={100} value={form.feeBps} onChange={(e) => set("feeBps", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="Slippage (bps)">
              <input type="number" min={0} max={100} value={form.slippageBps} onChange={(e) => set("slippageBps", +e.target.value)} className={inputClass} />
            </Field>
            <Field label="Stop loss % (opz.)">
              <input
                type="text"
                value={form.stopLossPct}
                onChange={(e) => set("stopLossPct", e.target.value)}
                className={inputClass}
                placeholder="es. 0.02"
              />
            </Field>
            <Field label="Take profit % (opz.)">
              <input
                type="text"
                value={form.takeProfitPct}
                onChange={(e) => set("takeProfitPct", e.target.value)}
                className={inputClass}
                placeholder="es. 0.05"
              />
            </Field>
            <Field label="Trailing stop % (opz.)">
              <input
                type="text"
                value={form.trailingStopPct}
                onChange={(e) => set("trailingStopPct", e.target.value)}
                className={inputClass}
                placeholder="es. 0.015"
              />
            </Field>
          </Section>

          <Section title="Esecuzione">
            <Field label="Modalità posizione">
              <select
                value={form.positionMode}
                onChange={(e) => set("positionMode", e.target.value as StrategyBuilderFormState["positionMode"])}
                className={selectClass}
              >
                <option value="long_only">Long only</option>
                <option value="long_short">Long / short</option>
              </select>
            </Field>
            <Field label="Rebalance">
              <select
                value={form.rebalance}
                onChange={(e) => set("rebalance", e.target.value as StrategyBuilderFormState["rebalance"])}
                className={selectClass}
              >
                <option value="equal_weight">Equal weight</option>
                <option value="dynamic">Dynamic</option>
              </select>
            </Field>
            <Field label="Timing ingresso">
              <select
                value={form.entryTiming}
                onChange={(e) => set("entryTiming", e.target.value as StrategyBuilderFormState["entryTiming"])}
                className={selectClass}
              >
                <option value="next_bar_open">Next bar open</option>
                <option value="bar_close">Bar close</option>
              </select>
            </Field>
          </Section>

          <Section title="Dati di mercato e qualità">
            <Field label="Asset class">
              <select
                value={form.assetClass}
                onChange={(e) => set("assetClass", e.target.value as StrategyBuilderFormState["assetClass"])}
                className={selectClass}
              >
                <option value="auto">Auto</option>
                <option value="equity">Equity</option>
                <option value="etf">ETF</option>
                <option value="crypto">Crypto</option>
              </select>
            </Field>
            <Field label="Provider preferito">
              <select
                value={form.providerPreference}
                onChange={(e) =>
                  set("providerPreference", e.target.value as StrategyBuilderFormState["providerPreference"])
                }
                className={selectClass}
              >
                <option value="auto">Auto</option>
                <option value="yahoo">Yahoo</option>
                <option value="stooq">Stooq (solo daily)</option>
              </select>
            </Field>
            <Field label="Quality policy">
              <select
                value={form.qualityPolicy}
                onChange={(e) => set("qualityPolicy", e.target.value as StrategyBuilderFormState["qualityPolicy"])}
                className={selectClass}
              >
                <option value="best_effort">Best effort</option>
                <option value="quality_labels">Quality labels</option>
                <option value="strict_gate">Strict gate</option>
              </select>
            </Field>
            <Field label="Freshness">
              <select
                value={form.freshnessRequirement}
                onChange={(e) =>
                  set("freshnessRequirement", e.target.value as StrategyBuilderFormState["freshnessRequirement"])
                }
                className={selectClass}
              >
                <option value="relaxed">Relaxed</option>
                <option value="standard">Standard</option>
                <option value="strict">Strict</option>
              </select>
            </Field>
            <Field label="Coverage">
              <select
                value={form.coverageRequirement}
                onChange={(e) =>
                  set("coverageRequirement", e.target.value as StrategyBuilderFormState["coverageRequirement"])
                }
                className={selectClass}
              >
                <option value="relaxed">Relaxed</option>
                <option value="standard">Standard</option>
                <option value="strict">Strict</option>
              </select>
            </Field>
            <div className="block space-y-1.5 flex flex-col justify-end">
              <span className={labelClass}>Corporate actions</span>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.corporateActionsRequired}
                  onChange={(e) => set("corporateActionsRequired", e.target.checked)}
                  className="rounded border-[var(--border-subtle)]"
                />
                <span className="text-[13px] text-[var(--text-secondary)] normal-case tracking-normal">
                  Dati aggiustati (split/dividendi) dove applicabile
                </span>
              </label>
            </div>
            <Field label="Note dati" className="sm:col-span-2 lg:col-span-3">
              <textarea
                value={form.dataNotes}
                onChange={(e) => set("dataNotes", e.target.value)}
                rows={2}
                className={`${inputClass} resize-y min-h-[64px]`}
                placeholder="Vincoli extra su provider, mercato, sessione, ecc."
              />
            </Field>
          </Section>

          <Section title="Backtest">
            <Field label="Finestra storica OHLCV">
              <select
                value={form.historyPeriod}
                onChange={(e) => set("historyPeriod", e.target.value as StrategyBuilderFormState["historyPeriod"])}
                className={selectClass}
              >
                <option value="1m">1 mese</option>
                <option value="3m">3 mesi</option>
                <option value="6m">6 mesi</option>
                <option value="1y">1 anno</option>
                <option value="2y">2 anni</option>
                <option value="5y">5 anni</option>
              </select>
            </Field>
            <div className="block space-y-1.5 flex flex-col justify-end">
              <span className={labelClass}>Dopo generazione</span>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={form.runBacktest}
                  onChange={(e) => set("runBacktest", e.target.checked)}
                  className="rounded border-[var(--border-subtle)]"
                />
                <span className="text-[13px] text-[var(--text-secondary)] normal-case tracking-normal">
                  Esegui run storico in coda
                </span>
              </label>
            </div>
          </Section>
        </div>
      </div>

      <footer className="shrink-0 flex flex-wrap items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-subtle)] bg-[rgba(0,0,0,0.35)]">
        <button
          type="button"
          onClick={onClose}
          className="rounded-[999px] border border-[var(--border-subtle)] px-4 py-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Annulla
        </button>
        <button
          type="button"
          disabled={loading || !form.ticker.trim()}
          onClick={onSubmit}
          className="btn-primary rounded-[999px] px-6 py-2 text-[12px] font-medium disabled:opacity-50 disabled:pointer-events-none"
        >
          {editingFromSpec ? "Rigenera strategia" : "Genera strategia"}
        </button>
      </footer>
    </div>
  );
}
