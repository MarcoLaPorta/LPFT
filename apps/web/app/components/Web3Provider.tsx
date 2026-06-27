"use client";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import "../rainbowkit-lpft.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { startTransition, useEffect, useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { chainById, resolveAfxChainId } from "../../lib/web3/chains";
import { lpftRainbowTheme } from "../../lib/web3/rainbowkit-lpft-theme";
import { wagmiConfig } from "../../lib/web3/wagmi-config";

type Web3ProviderProps = {
  children: ReactNode;
};

/**
 * Wagmi/RainbowKit solo dopo mount client.
 * Evita "Cannot update ConnectButton while rendering Hydrate" (setState durante hydration).
 */
export function Web3Provider({ children }: Web3ProviderProps) {
  const [mounted, setMounted] = useState(false);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, refetchOnWindowFocus: false },
        },
      }),
  );

  useEffect(() => {
    startTransition(() => {
      setMounted(true);
    });
  }, []);

  if (!mounted) {
    return <div suppressHydrationWarning>{children}</div>;
  }

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={chainById(resolveAfxChainId())}
          theme={lpftRainbowTheme()}
          locale="en"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
