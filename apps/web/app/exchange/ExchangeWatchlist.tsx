"use client";

import { useMemo, useState } from "react";
import {
  TV_CATEGORY_LABELS,
  TV_US_LEADERS,
  type TvLeaderRow,
  type TvMarketCategory,
} from "../../lib/tvUsSymbols";
import { fmtPct, fmtPrice, pctTone, tvToDisplaySymbol } from "./exchange-format";
import type { FullExchangeQuote } from "./exchange-types";

type Props = {
  activeTv: string;
  quoteMap: Map<string, FullExchangeQuote>;
  search: string;
  onSearch: (q: string) => void;
  onSelect: (tv: string) => void;
  quotesErr: string | null;
};

const CATEGORIES: TvMarketCategory[] = ["index", "etf", "equity"];

export function ExchangeWatchlist({
  activeTv,
  quoteMap,
  search,
  onSearch,
  onSelect,
  quotesErr,
}: Props) {
  const [filter, setFilter] = useState<TvMarketCategory | "all">("all");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return TV_US_LEADERS.filter((row) => {
      if (filter !== "all" && row.category !== filter) return false;
      if (!q) return true;
      return (
        row.tv.toLowerCase().includes(q) ||
        row.name.toLowerCase().includes(q) ||
        row.yahoo.toLowerCase().includes(q) ||
        tvToDisplaySymbol(row.tv).toLowerCase().includes(q)
      );
    });
  }, [search, filter]);

  const grouped = useMemo(() => {
    if (filter !== "all") return [{ cat: filter, items: rows }];
    return CATEGORIES.map((cat) => ({
      cat,
      items: rows.filter((r) => r.category === cat),
    })).filter((g) => g.items.length > 0);
  }, [rows, filter]);

  return (
    <aside className="lpft-exchange-watchlist">
      <div className="lpft-exchange-watchlist-head">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Cerca simbolo…"
          className="lpft-exchange-search"
          aria-label="Cerca mercato"
        />
        <div className="lpft-exchange-filter-tabs" role="tablist" aria-label="Filtra categoria">
          <FilterTab active={filter === "all"} onClick={() => setFilter("all")} label="Tutti" />
          {CATEGORIES.map((c) => (
            <FilterTab
              key={c}
              active={filter === c}
              onClick={() => setFilter(c)}
              label={TV_CATEGORY_LABELS[c]}
            />
          ))}
        </div>
      </div>

      <div className="lpft-exchange-table-wrap scrollbar-thin">
        {quotesErr ? (
          <p className="p-3 text-[12px] text-[var(--danger)]">{quotesErr}</p>
        ) : (
          <table className="lpft-exchange-table">
            <thead>
              <tr>
                <th>Simbolo</th>
                <th className="text-right">Ultimo</th>
                <th className="text-right">24h</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ cat, items }) => (
                <WatchlistGroup
                  key={cat}
                  label={filter === "all" ? TV_CATEGORY_LABELS[cat] : undefined}
                  items={items}
                  activeTv={activeTv}
                  quoteMap={quoteMap}
                  onSelect={onSelect}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </aside>
  );
}

function FilterTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={active ? "lpft-exchange-filter-tab lpft-exchange-filter-tab--on" : "lpft-exchange-filter-tab"}
    >
      {label}
    </button>
  );
}

function WatchlistGroup({
  label,
  items,
  activeTv,
  quoteMap,
  onSelect,
}: {
  label?: string;
  items: TvLeaderRow[];
  activeTv: string;
  quoteMap: Map<string, FullExchangeQuote>;
  onSelect: (tv: string) => void;
}) {
  return (
    <>
      {label ? (
        <tr className="lpft-exchange-table-group">
          <td colSpan={3}>{label}</td>
        </tr>
      ) : null}
      {items.map((row) => (
        <WatchlistRow
          key={row.tv}
          row={row}
          selected={row.tv === activeTv}
          quote={quoteMap.get(row.yahoo)}
          onSelect={() => onSelect(row.tv)}
        />
      ))}
    </>
  );
}

function WatchlistRow({
  row,
  selected,
  quote,
  onSelect,
}: {
  row: TvLeaderRow;
  selected: boolean;
  quote: FullExchangeQuote | undefined;
  onSelect: () => void;
}) {
  const pct = quote?.regularMarketChangePercent;
  const tone = pctTone(pct);
  return (
    <tr
      className={selected ? "lpft-exchange-table-row lpft-exchange-table-row--active" : "lpft-exchange-table-row"}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      role="button"
    >
      <td>
        <span className="lpft-exchange-table-sym">{tvToDisplaySymbol(row.tv)}</span>
        <span className="lpft-exchange-table-name">{row.name}</span>
      </td>
      <td className="text-right text-[12px]">{fmtPrice(quote?.regularMarketPrice)}</td>
      <td className={`text-right text-[12px] lpft-exchange-chg--${tone}`}>{fmtPct(pct)}</td>
    </tr>
  );
}
