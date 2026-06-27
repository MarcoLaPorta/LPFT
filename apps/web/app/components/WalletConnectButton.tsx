"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { startTransition, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useAfxStore } from "../../lib/afx-store";

function shortAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function ConnectButtonPlaceholder() {
  return (
    <div
      aria-hidden
      className="lpft-wallet-btn lpft-wallet-btn--placeholder"
    />
  );
}

function WalletIcon({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return (
      <span className="lpft-wallet-chain-fallback" aria-hidden>
        ◆
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- icon URL dinamico da wallet/chain
    <img src={src} alt={alt} width={16} height={16} className="lpft-wallet-chain-icon" />
  );
}

function ConnectButtonInner() {
  const { address, isConnected } = useAccount();
  const setWalletAddress = useAfxStore((s) => s.setWalletAddress);

  useEffect(() => {
    if (isConnected && address) {
      setWalletAddress(address);
    }
  }, [isConnected, address, setWalletAddress]);

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          return <ConnectButtonPlaceholder />;
        }

        if (!connected) {
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="lpft-wallet-btn lpft-wallet-btn--connect"
            >
              <span className="lpft-wallet-btn-dot" aria-hidden />
              Connetti wallet
            </button>
          );
        }

        const label =
          account.ensName ?? shortAddress(account.address);
        const chainLabel = chain.unsupported
          ? "Rete non supportata"
          : (chain.name ?? `Chain ${chain.id}`);

        return (
          <div className="lpft-wallet-btn-group">
            <button
              type="button"
              onClick={openChainModal}
              className={[
                "lpft-wallet-chain",
                chain.unsupported ? "lpft-wallet-chain--warn" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              title={chainLabel}
              aria-label={`Rete: ${chainLabel}`}
            >
              {chain.hasIcon ? (
                <WalletIcon src={chain.iconUrl} alt={chainLabel} />
              ) : (
                <span className="lpft-wallet-chain-fallback" aria-hidden>
                  {chain.id}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={openAccountModal}
              className="lpft-wallet-account"
              title={account.address}
            >
              {label}
            </button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/**
 * Pulsante wallet LPFT + modale RainbowKit tematizzata.
 * Render solo dopo mount (evita hydration mismatch).
 */
export function WalletConnectButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    startTransition(() => {
      setMounted(true);
    });
  }, []);

  if (!mounted) {
    return <ConnectButtonPlaceholder />;
  }

  return (
    <div className="lpft-wallet-connect">
      <ConnectButtonInner />
    </div>
  );
}
