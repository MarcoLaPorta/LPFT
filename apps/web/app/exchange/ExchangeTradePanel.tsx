"use client";

import Link from "next/link";
import { useState } from "react";
import type { TvLeaderRow } from "../../lib/tvUsSymbols";
import {
  fmtChange,
  fmtPct,
  fmtPrice,
  fmtVolume,
  pctTone,
  tvToDisplaySymbol,
} from "./exchange-format";
import type { FullExchangeQuote } from "./exchange-types";

type Props = {
  row: TvLeaderRow;
  quote: FullExchangeQuote | undefined;
};

export function ExchangeTradePanel({ row, quote }: Props) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"limit" | "market">("limit");
  const [qty, setQty] = useState("10");

  const px = quote?.regularMarketPrice ?? 0;
  const pct = quote?.regularMarketChangePercent;
  const tone = pctTone(pct);

  return (
    <aside className="lpft-exchange-trade">
      <div className={`lpft-exchange-quote lpft-exchange-chg--${tone}`}>
        <p className="lpft-exchange-quote-sym">
          {tvToDisplaySymbol(row.tv)}
          <span className="lpft-exchange-quote-paper">Paper</span>
        </p>
        <p className="lpft-exchange-quote-px">{fmtPrice(px)}</p>
        <p className="lpft-exchange-quote-chg">
          {fmtChange(quote?.regularMarketChange)} · {fmtPct(pct)}
        </p>
      </div>

      <dl className="lpft-exchange-stats-grid">
        <Stat label="O" value={fmtPrice(quote?.regularMarketOpen)} />
        <Stat label="H" value={fmtPrice(quote?.regularMarketDayHigh)} />
        <Stat label="L" value={fmtPrice(quote?.regularMarketDayLow)} />
        <Stat label="Vol" value={fmtVolume(quote?.regularMarketVolume)} />
      </dl>

      <div className="lpft-exchange-order-card">
        <div className="lpft-exchange-side-toggle">
          <button
            type="button"
            className={side === "buy" ? "lpft-exchange-side lpft-exchange-side--buy-on" : "lpft-exchange-side lpft-exchange-side--buy"}
            onClick={() => setSide("buy")}
          >
            Acquista
          </button>
          <button
            type="button"
            className={side === "sell" ? "lpft-exchange-side lpft-exchange-side--sell-on" : "lpft-exchange-side lpft-exchange-side--sell"}
            onClick={() => setSide("sell")}
          >
            Vendi
          </button>
        </div>

        <div className="lpft-exchange-order-types">
          {(["limit", "market"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={
                orderType === t ? "lpft-exchange-order-type lpft-exchange-order-type--on" : "lpft-exchange-order-type"
              }
              onClick={() => setOrderType(t)}
            >
              {t === "limit" ? "Limit" : "Market"}
            </button>
          ))}
        </div>

        <label className="lpft-exchange-field">
          <span>Qty</span>
          <input
            type="number"
            min={0}
            step={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="lpft-exchange-input"
          />
        </label>
        <label className="lpft-exchange-field">
          <span>Prezzo</span>
          <input
            type="text"
            readOnly
            value={orderType === "market" ? "Market" : fmtPrice(px)}
            className="lpft-exchange-input"
            aria-readonly="true"
          />
        </label>

        <button
          type="button"
          disabled
          title="Paper — nessun ordine reale"
          className={
            side === "buy" ? "lpft-exchange-submit lpft-exchange-submit--buy" : "lpft-exchange-submit lpft-exchange-submit--sell"
          }
        >
          {side === "buy" ? "Acquista" : "Vendi"}
        </button>
        <Link
          href={`/?symbol=${encodeURIComponent(row.yahoo)}`}
          className="lpft-btn-secondary inline-flex w-full justify-center py-1.5 text-[11px]"
        >
          Analizza in chat
        </Link>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="lpft-exchange-stat">
      <dt className="lpft-exchange-stat-label">{label}</dt>
      <dd className="lpft-exchange-stat-value">{value}</dd>
    </div>
  );
}
