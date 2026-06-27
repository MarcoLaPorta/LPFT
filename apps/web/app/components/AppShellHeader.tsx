"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { WalletConnectButton } from "./WalletConnectButton";

const API_DOCS_URL = `${(
  process.env.NEXT_PUBLIC_LPFT_API_BASE ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:8000"
).replace(/\/$/, "")}/docs`;

type NavPath = "/" | "/vault" | "/strategies" | "/exchange";

type AppShellHeaderProps = {
  activePath?: NavPath;
  /** Contenuto extra a destra (es. tab Exchange), prima del wallet */
  rightSlot?: ReactNode;
};

function navLinkClass(active: boolean): string {
  return [
    "rounded-md px-2.5 py-1.5 text-[12px] transition-colors",
    active
      ? "bg-[var(--accent-muted)] text-[var(--text-primary)]"
      : "text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--text-primary)]",
  ].join(" ");
}

export function AppShellHeader({ activePath = "/", rightSlot }: AppShellHeaderProps) {
  return (
    <header className="lpft-app-header shrink-0">
      <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2.5 hover:opacity-90">
        <div className="lpft-app-brand-mark" aria-hidden>
          L
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[13px] font-semibold tracking-tight">LPFT</span>
          <span className="lpft-app-brand-tag">AFX</span>
        </div>
      </Link>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2">
        {rightSlot}
        <nav className="flex shrink-0 items-center gap-0.5 sm:gap-1" aria-label="Navigazione principale">
          <Link href="/" className={navLinkClass(activePath === "/")}>
            Chat
          </Link>
          <Link href="/vault" className={navLinkClass(activePath === "/vault")}>
            Vault
          </Link>
          <Link href="/strategies" className={navLinkClass(activePath === "/strategies")}>
            Strategie
          </Link>
          <Link href="/exchange" className={navLinkClass(activePath === "/exchange")}>
            Mercati
          </Link>
          <a
            href={API_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden rounded-md px-2.5 py-1.5 text-[12px] text-[var(--text-tertiary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-[var(--text-primary)] sm:inline"
          >
            API
          </a>
        </nav>
        <div className="ml-1 shrink-0 sm:ml-2">
          <WalletConnectButton />
        </div>
      </div>
    </header>
  );
}
