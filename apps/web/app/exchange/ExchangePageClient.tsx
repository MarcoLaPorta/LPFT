"use client";

import { useState } from "react";
import type { AfxHealthPayload } from "../../lib/afxHealthTypes";
import { AppShellHeader } from "../components/AppShellHeader";
import { ExchangeMarketsView } from "./ExchangeMarketsView";
import { RefreshExchangeButton } from "./RefreshExchangeButton";

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  } catch {
    return JSON.stringify({ error: "Impossibile serializzare la risposta health" });
  }
}

type Tab = "markets" | "infra";

function ExchangeTabs({
  tab,
  onTab,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
}) {
  const btn = (id: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => onTab(id)}
      className={tab === id ? "lpft-exchange-tab lpft-exchange-tab--on" : "lpft-exchange-tab"}
    >
      {label}
    </button>
  );

  return (
    <div className="lpft-exchange-tabs" role="tablist" aria-label="Sezioni exchange">
      {btn("markets", "Mercati")}
      {btn("infra", "Sistema")}
    </div>
  );
}

export default function ExchangePageClient({
  healthOk,
  healthPayload,
}: {
  healthOk: boolean;
  healthPayload: AfxHealthPayload;
}) {
  const [tab, setTab] = useState<Tab>("markets");

  return (
    <div className="lpft-app-shell lpft-app-shell--screen lpft-exchange-page">
      <AppShellHeader activePath="/exchange" rightSlot={<ExchangeTabs tab={tab} onTab={setTab} />} />

      {tab === "markets" ? (
        <ExchangeMarketsView />
      ) : (
        <main className="lpft-exchange-infra">
          <div className="lpft-exchange-infra-head">
            <h1 className="lpft-exchange-infra-title">Sistema</h1>
            <p className="lpft-exchange-infra-status">
              Health AFX ·{" "}
              <span className={healthOk ? "lpft-exchange-infra-ok" : "lpft-exchange-infra-err"}>
                {healthOk ? "ok" : "errore"}
              </span>
            </p>
            <RefreshExchangeButton />
          </div>
          <pre className="lpft-exchange-infra-pre">{safeJsonStringify(healthPayload)}</pre>
        </main>
      )}
    </div>
  );
}
