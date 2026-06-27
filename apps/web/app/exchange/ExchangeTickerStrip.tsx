"use client";

import type { TvLeaderRow } from "../../lib/tvUsSymbols";
import { fmtPct, fmtPrice, pctTone, tvToDisplaySymbol } from "./exchange-format";

export type ExchangeQuote = {
  symbol: string;
  regularMarketPrice: number | null;
  regularMarketChangePercent: number | null;
};

type Props = {
  leaders: TvLeaderRow[];
  quoteMap: Map<string, ExchangeQuote>;
  activeTv: string;
  onSelect: (tv: string) => void;
};

export function ExchangeTickerStrip({ leaders, quoteMap, activeTv, onSelect }: Props) {
  const loop = [...leaders, ...leaders];
  return (
    <div className="lpft-exchange-ticker" aria-label="Ticker mercati">
      <div className="lpft-exchange-ticker-track">
        {loop.map((row, idx) => {
          const q = quoteMap.get(row.yahoo);
          const tone = pctTone(q?.regularMarketChangePercent);
          const sym = tvToDisplaySymbol(row.tv);
          return (
            <button
              key={`${row.tv}-${idx}`}
              type="button"
              onClick={() => onSelect(row.tv)}
              className={[
                "lpft-exchange-ticker-item",
                row.tv === activeTv ? "lpft-exchange-ticker-item--active" : "",
              ].join(" ")}
            >
              <span className="lpft-exchange-ticker-sym">{sym}</span>
              <span className="lpft-exchange-ticker-px">{fmtPrice(q?.regularMarketPrice)}</span>
              <span className={`lpft-exchange-ticker-chg lpft-exchange-ticker-chg--${tone}`}>
                {fmtPct(q?.regularMarketChangePercent)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
