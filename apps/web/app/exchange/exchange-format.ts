export function fmtPrice(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function fmtChange(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtPrice(n)}`;
}

export function fmtVolume(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function pctTone(p: number | null | undefined): "up" | "down" | "flat" {
  if (p == null || !Number.isFinite(p) || Math.abs(p) < 1e-6) return "flat";
  return p > 0 ? "up" : "down";
}

export function tvToDisplaySymbol(tv: string): string {
  const parts = tv.split(":");
  return parts.length > 1 ? parts[1]! : tv;
}

export function marketStateLabel(state: string | null | undefined): { label: string; tone: "open" | "closed" | "unknown" } {
  if (!state) return { label: "—", tone: "unknown" };
  const u = state.toUpperCase();
  if (u.includes("REGULAR") || u === "OPEN") return { label: "Mercato aperto", tone: "open" };
  if (u.includes("PRE")) return { label: "Pre-market", tone: "open" };
  if (u.includes("POST")) return { label: "After-hours", tone: "open" };
  if (u.includes("CLOSED")) return { label: "Chiuso", tone: "closed" };
  return { label: state, tone: "unknown" };
}
