"use client";

import { useEffect, useMemo, useState } from "react";
import { TV_US_LEADERS } from "../../lib/tvUsSymbols";
import { TradingViewChart } from "../components/TradingViewChart";
import { ExchangeTradePanel } from "./ExchangeTradePanel";
import { ExchangeWatchlist } from "./ExchangeWatchlist";
import { marketStateLabel, tvToDisplaySymbol } from "./exchange-format";
import type { ChartInterval, FullExchangeQuote } from "./exchange-types";
import { CHART_INTERVALS } from "./exchange-types";

type QuotesPayload = { quotes: FullExchangeQuote[] };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : res.statusText);
  return j as T;
}

export function ExchangeMarketsView() {
  const [tvSymbol, setTvSymbol] = useState(TV_US_LEADERS[2]!.tv);
  const [interval, setInterval] = useState<ChartInterval>("D");
  const [search, setSearch] = useState("");
  const [quotes, setQuotes] = useState<FullExchangeQuote[] | undefined>();
  const [quotesErr, setQuotesErr] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const yahooList = useMemo(() => TV_US_LEADERS.map((r) => r.yahoo).join(","), []);
  const quotesUrl = `/api/market/quotes?symbols=${encodeURIComponent(yahooList)}`;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetchJson<QuotesPayload>(quotesUrl);
        if (!cancelled) {
          setQuotes(data.quotes);
          setQuotesErr(null);
          setLastRefresh(new Date());
        }
      } catch (e) {
        if (!cancelled) setQuotesErr(e instanceof Error ? e.message : "Errore quotazioni");
      }
    };
    void load();
    const id = window.setInterval(load, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [quotesUrl]);

  const quoteMap = useMemo(() => {
    const m = new Map<string, FullExchangeQuote>();
    for (const q of quotes ?? []) m.set(q.symbol, q);
    return m;
  }, [quotes]);

  const active = TV_US_LEADERS.find((r) => r.tv === tvSymbol) ?? TV_US_LEADERS[0]!;
  const activeQuote = quoteMap.get(active.yahoo);
  const spyQuote = quoteMap.get("SPY");
  const session = marketStateLabel(spyQuote?.marketState ?? activeQuote?.marketState);

  return (
    <div className="lpft-exchange-shell">
      <div className="lpft-exchange-grid">
        <ExchangeWatchlist
          activeTv={tvSymbol}
          quoteMap={quoteMap}
          search={search}
          onSearch={setSearch}
          onSelect={setTvSymbol}
          quotesErr={quotesErr}
        />

        <section className="lpft-exchange-center">
          <header className="lpft-exchange-chart-bar">
            <div className="min-w-0">
              <h1 className="lpft-exchange-symbol-title">
                {tvToDisplaySymbol(active.tv)}
                <span className="lpft-exchange-symbol-sub">{active.name}</span>
              </h1>
              <p className="lpft-exchange-symbol-meta">
                <span className={`lpft-exchange-session lpft-exchange-session--${session.tone}`}>
                  {session.label}
                </span>
                {lastRefresh ? (
                  <span>
                    {" · "}
                    {lastRefresh.toLocaleTimeString("it-IT", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="lpft-exchange-intervals" role="group" aria-label="Timeframe grafico">
              {CHART_INTERVALS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={
                    interval === t.id
                      ? "lpft-exchange-interval lpft-exchange-interval--on"
                      : "lpft-exchange-interval"
                  }
                  onClick={() => setInterval(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </header>

          <div className="lpft-exchange-chart">
            <TradingViewChart
              key={`${tvSymbol}-${interval}`}
              symbol={tvSymbol}
              interval={interval}
              fill
            />
          </div>
        </section>

        <ExchangeTradePanel row={active} quote={activeQuote} />
      </div>
    </div>
  );
}
