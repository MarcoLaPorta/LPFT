import { isCryptoSymbol, isUsListedEquity } from "./router";

/** Durata minima copertura eventi in una sessione. */
export const HFT_MIN_REPLAY_SECONDS = 3600;

/** Cap singola sessione: 24h (giornata crypto intera). */
export const HFT_MAX_REPLAY_SECONDS = 86_400;

export const HFT_MIN_REPLAY_SPAN_MS = HFT_MIN_REPLAY_SECONDS * 1000;

/** Default: ultimo mese, ogni giorno (non 1h/settimana). */
export const HFT_DEFAULT_LOOKBACK_DAYS = 30;
export const HFT_DEFAULT_MAX_SESSIONS = 30;

export type AlpacaTickRoute =
  | { assetClass: "us_equity"; alpacaSymbol: string }
  | { assetClass: "crypto"; alpacaSymbol: string };

export function resolveAlpacaTickRoute(symbol: string): AlpacaTickRoute | null {
  const raw = symbol.trim().toUpperCase();
  if (isUsListedEquity(raw)) {
    return { assetClass: "us_equity", alpacaSymbol: raw };
  }
  if (isCryptoSymbol(raw)) {
    const base = raw.replace(/\/USD$/, "").replace(/-USD$/, "");
    if (!base) return null;
    return { assetClass: "crypto", alpacaSymbol: `${base}/USD` };
  }
  return null;
}

export function resolveHftReplayWindowSeconds(requestedSeconds: number): number {
  const req = Number.isFinite(requestedSeconds) ? requestedSeconds : HFT_MIN_REPLAY_SECONDS;
  return Math.min(HFT_MAX_REPLAY_SECONDS, Math.max(HFT_MIN_REPLAY_SECONDS, req));
}

/** @deprecated Preferire buildHftReplaySessions. */
export function resolveHftReplayRange(requestedSeconds: number): { start: Date; end: Date; windowSeconds: number } {
  const windowSeconds = resolveHftReplayWindowSeconds(requestedSeconds);
  const end = new Date();
  const start = new Date(end.getTime() - windowSeconds * 1000);
  return { start, end, windowSeconds };
}

export type HftReplaySessionWindow = {
  start: Date;
  end: Date;
  label: string;
};

export type BuildHftReplaySessionsInput = {
  lookbackDays: number;
  maxSessions: number;
  sessionSeconds?: number;
  assetClass: AlpacaTickRoute["assetClass"];
  anchorEnd?: Date;
};

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Una sessione = intera giornata di microstructure.
 * Crypto: 00:00–24:00 UTC. Equity US: RTH 14:30–21:00 UTC (~9:30–16:00 ET).
 */
export function hftSessionWindowForDay(
  dayUtc: Date,
  assetClass: AlpacaTickRoute["assetClass"],
): HftReplaySessionWindow | null {
  const y = dayUtc.getUTCFullYear();
  const m = dayUtc.getUTCMonth();
  const d = dayUtc.getUTCDate();
  const dow = dayUtc.getUTCDay();

  if (assetClass === "us_equity") {
    if (dow === 0 || dow === 6) return null;
    const start = new Date(Date.UTC(y, m, d, 14, 30, 0));
    const end = new Date(Date.UTC(y, m, d, 21, 0, 0));
    return { start, end, label: start.toISOString().slice(0, 10) };
  }

  const start = new Date(Date.UTC(y, m, d, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, d + 1, 0, 0, 0));
  return { start, end, label: start.toISOString().slice(0, 10) };
}

/** Sessioni giornaliere sull'orizzonte (default: ogni giorno dell'ultimo mese). */
export function buildHftReplaySessions(input: BuildHftReplaySessionsInput): HftReplaySessionWindow[] {
  const lookbackDays = Math.min(365, Math.max(1, input.lookbackDays));
  const maxSessions = Math.min(365, Math.max(1, input.maxSessions));
  const anchorEnd = input.anchorEnd ?? new Date();
  const sessions: HftReplaySessionWindow[] = [];
  const seen = new Set<string>();

  for (let offset = 0; offset < lookbackDays && sessions.length < maxSessions; offset++) {
    const day = new Date(anchorEnd.getTime() - offset * 86_400_000);
    const window = hftSessionWindowForDay(utcDayStart(day), input.assetClass);
    if (!window) continue;
    if (window.start >= anchorEnd) continue;
    const clippedEnd =
      window.end > anchorEnd ? anchorEnd : window.end;
    const clipped = { ...window, end: clippedEnd };
    const key = clipped.start.toISOString();
    if (seen.has(key)) continue;
    seen.add(key);
    sessions.push(clipped);
  }

  return sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function sessionWindowSeconds(window: HftReplaySessionWindow): number {
  return Math.max(1, Math.floor((window.end.getTime() - window.start.getTime()) / 1000));
}
