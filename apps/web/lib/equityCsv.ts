import type { LineData, Time, UTCTimestamp } from "lightweight-charts";

export function parseEquityCsv(csvText: string): LineData[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((s) => s.trim());
  const hl = (h: string) => h.toLowerCase();
  const timeIdx = header.findIndex(
    (h) =>
      hl(h) === "datetime" ||
      hl(h) === "date" ||
      hl(h) === "timestamp" ||
      hl(h) === "time" ||
      h === "0"
  );
  const valueIdx = header.findIndex((h) => h === "0" || h.toLowerCase() === "equity" || h === "value");
  const tIdx = timeIdx >= 0 ? timeIdx : 0;
  const vIdx = valueIdx >= 0 ? valueIdx : header.length - 1;
  const out: LineData[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim());
    const rawTime = parts[tIdx];
    const value = parseFloat(parts[vIdx]);
    if (Number.isNaN(value)) continue;
    let timeSec: number;
    if (/^\d{10,}$/.test(rawTime)) {
      timeSec = parseInt(rawTime, 10);
    } else {
      const d = new Date(rawTime);
      timeSec = Math.floor(d.getTime() / 1000);
    }
    if (!Number.isFinite(timeSec) || timeSec <= 0) continue;
    out.push({ time: timeSec as UTCTimestamp as Time, value });
  }
  return out.sort((a, b) => Number(a.time) - Number(b.time));
}
