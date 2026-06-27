"use client";

import { VaultDashboard } from "../components/VaultDashboard";
import { AppShellHeader } from "../components/AppShellHeader";

export default function VaultPage() {
  return (
    <div className="lpft-app-shell lpft-app-shell--screen">
      <AppShellHeader activePath="/vault" />
      <main className="lpft-page-main lpft-page-main--narrow">
        <section className="lpft-vault-hero">
          <p className="lpft-page-tag">Web3 · ERC-4626</p>
          <h1 className="lpft-page-title">Smart Vault</h1>
          <p className="lpft-page-lead">
            Crea il tuo vault isolato, deposita USDC e abilita il keeper AFX per i trade on-chain.
          </p>
        </section>
        <div className="lpft-card lpft-card--lite lpft-vault-panel">
          <VaultDashboard />
        </div>
      </main>
    </div>
  );
}
