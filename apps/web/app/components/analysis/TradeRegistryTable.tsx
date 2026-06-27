"use client";

import { fmtPctFrac } from "../../../lib/afx-derived-stats";
import type { SimulatedTrade } from "../../../services/quant/backtest";

export function TradeRegistryTable({ trades }: { trades: SimulatedTrade[] }) {
  if (trades.length === 0) {
    return (
      <p className="text-[12px] text-[var(--text-tertiary)]">Nessun trade simulato nel backtest.</p>
    );
  }

  return (
    <div className="w-full min-w-0">
      <p className="text-[11px] font-semibold text-[var(--text-primary)]">Registro trade</p>
      <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
        Elenco completo delle operazioni simulate
      </p>
      <div className="lpft-report-table-wrap lpft-trade-registry-wrap mt-3 w-full overflow-x-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="sticky top-0 bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
            <tr>
              <th className="w-10 px-3 py-2">#</th>
              <th className="w-[7.5rem] px-3 py-2">Ingresso</th>
              <th className="w-[7.5rem] px-3 py-2">Uscita</th>
              <th className="w-20 px-3 py-2 text-right">PnL %</th>
              <th className="w-24 px-3 py-2 text-right">PnL eq.</th>
              <th className="px-3 py-2">Motivi</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr
                key={t.tradeIndex}
                className="border-t border-[var(--border-subtle)] hover:bg-[rgba(255,255,255,0.02)]"
              >
                <td className="px-3 py-2">{t.tradeIndex}</td>
                <td className="px-3 py-2">{t.entryDate}</td>
                <td className="px-3 py-2">{t.exitDate}</td>
                <td
                  className={`px-3 py-2 text-right ${t.pnlFrac >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}
                >
                  {fmtPctFrac(t.pnlFrac, 2)}
                </td>
                <td className="px-3 py-2 text-right">{t.pnlEquity.toFixed(4)}</td>
                <td className="px-3 py-2 text-[10px] leading-snug text-[var(--text-tertiary)]">
                  <span className="break-words">{t.reasonEntry} → {t.reasonExit}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
