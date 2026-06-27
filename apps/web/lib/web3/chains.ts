import { defineChain } from "viem";
import { arbitrumSepolia } from "wagmi/chains";

const localRpc =
  process.env.NEXT_PUBLIC_RPC_LOCAL?.trim() ?? "http://127.0.0.1:8545";

/** Anvil / Hardhat locale — RPC esplicito (evita default wagmi hardhat). */
export const anvilLocal = defineChain({
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [localRpc] },
  },
});

/** Chain supportate MVP: locale + (opzionale) Arbitrum Sepolia. */
export const afxChains = [anvilLocal, arbitrumSepolia] as const;

export type AfxChainId = (typeof afxChains)[number]["id"];

export function resolveAfxChainId(): number {
  const raw = Number(process.env.NEXT_PUBLIC_AFX_CHAIN_ID ?? anvilLocal.id);
  return Number.isFinite(raw) ? raw : anvilLocal.id;
}

export function chainById(chainId: number) {
  return afxChains.find((c) => c.id === chainId) ?? anvilLocal;
}
