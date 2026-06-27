import { create } from "zustand";
import { persist } from "zustand/middleware";

const defaultWallet =
  process.env.NEXT_PUBLIC_AFX_DEFAULT_WALLET ??
  "0x0000000000000000000000000000000000000afb";

type AfxUiState = {
  walletAddress: string;
  lastExecutionLogId: string | null;
  setWalletAddress: (w: string) => void;
  setLastExecutionLogId: (id: string | null) => void;
};

export const useAfxStore = create<AfxUiState>()(
  persist(
    (set) => ({
      walletAddress: defaultWallet,
      lastExecutionLogId: null,
      setWalletAddress: (w) =>
        set({ walletAddress: w.trim().toLowerCase() || defaultWallet }),
      setLastExecutionLogId: (id) => set({ lastExecutionLogId: id }),
    }),
    {
      name: "afx-terminal-v1",
      partialize: (s) => ({ walletAddress: s.walletAddress }),
      /** Evita accesso a `localStorage` durante SSR (ReferenceError → 500). */
      skipHydration: true,
    },
  ),
);
