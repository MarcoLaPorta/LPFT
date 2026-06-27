"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAfxStore } from "@/lib/afx-store";
import { TerminalChat } from "./TerminalChat";

export function TerminalShell() {
  const walletAddress = useAfxStore((s) => s.walletAddress);
  const setWallet = useAfxStore((s) => s.setWalletAddress);

  useEffect(() => {
    void useAfxStore.persist.rehydrate();
  }, []);

  return (
    <div className="flex h-[100dvh] flex-col bg-black text-zinc-100">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-zinc-950/90 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-mono text-[11px] uppercase tracking-widest text-zinc-500 hover:text-violet-400"
          >
            ←
          </Link>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-violet-400/90">
              AFX
            </p>
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100 sm:text-base">
              Quant Terminal
            </h1>
          </div>
        </div>
        <label className="flex max-w-md flex-1 items-center gap-2 font-mono text-[11px] text-zinc-500">
          <span className="hidden shrink-0 sm:inline">WALLET</span>
          <input
            value={walletAddress}
            onChange={(e) => setWallet(e.target.value)}
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-white/10 bg-black px-2 py-1.5 text-xs text-violet-200/95 placeholder:text-zinc-600 focus:border-violet-500/40 focus:outline-none"
            placeholder="0x…"
          />
        </label>
      </header>

      <TerminalChat />
    </div>
  );
}
