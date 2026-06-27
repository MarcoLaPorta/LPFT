import { isAddress, type Address } from "viem";
import { resolveAfxChainId } from "./chains";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function envAddress(name: string, fallback = ZERO): Address {
  const v = process.env[name]?.trim();
  if (v && isAddress(v)) return v;
  return fallback;
}

export function getVaultFactoryAddress(): Address {
  return envAddress("NEXT_PUBLIC_AFX_VAULT_FACTORY_ADDRESS");
}

export function getUsdcAddress(): Address {
  return envAddress("NEXT_PUBLIC_AFX_USDC_ADDRESS");
}

export function isWeb3Configured(): boolean {
  const factory = getVaultFactoryAddress();
  return factory !== ZERO;
}

export function getTargetChainId(): number {
  return resolveAfxChainId();
}
