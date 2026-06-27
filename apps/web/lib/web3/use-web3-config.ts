"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { getTargetChainId, getUsdcAddress, getVaultFactoryAddress, isWeb3Configured } from "./contracts";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export type Web3RuntimeConfig = {
  factoryAddress: Address;
  usdcAddress: Address;
  chainId: number;
  configured: boolean;
};

function fromBuildEnv(): Web3RuntimeConfig {
  const factoryAddress = getVaultFactoryAddress();
  return {
    factoryAddress,
    usdcAddress: getUsdcAddress(),
    chainId: getTargetChainId(),
    configured: isWeb3Configured(),
  };
}

/**
 * Preferisce /api/web3/config (legge .env lato server) così la pagina Vault
 * non dipende dal bundle client con NEXT_PUBLIC_* iniettati al compile-time.
 */
export function useWeb3Config() {
  const [config, setConfig] = useState<Web3RuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/web3/config", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Partial<Web3RuntimeConfig>;
        if (cancelled) return;
        setConfig({
          factoryAddress: (data.factoryAddress as Address) ?? ZERO,
          usdcAddress: (data.usdcAddress as Address) ?? ZERO,
          chainId: typeof data.chainId === "number" ? data.chainId : getTargetChainId(),
          configured: Boolean(data.configured),
        });
      } catch {
        if (!cancelled) setConfig(fromBuildEnv());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { config, loading };
}
