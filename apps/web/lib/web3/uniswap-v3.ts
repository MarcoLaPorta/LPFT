import type { Address } from "viem";

/** SwapRouter02 — Ethereum / Arbitrum One. */
export const UNISWAP_V3_SWAP_ROUTER02_MAINNET = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as Address;

/** SwapRouter02 — Arbitrum Sepolia (diverso dal mainnet!). */
export const UNISWAP_V3_SWAP_ROUTER02_ARBITRUM_SEPOLIA =
  "0x101F443B4d1b059569D643917553c771E1b9663E" as Address;

/** @deprecated Usa defaultUniswapV3Router(chainId). */
export const UNISWAP_V3_SWAP_ROUTER02 = UNISWAP_V3_SWAP_ROUTER02_MAINNET;

/** Universal Router (swap compositi) — non usato da exactInputSingle MVP. */
export const UNISWAP_UNIVERSAL_ROUTER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD" as Address;

/** Fee tier 0.3% (uint24). */
export const UNISWAP_V3_FEE_TIER_3000 = 3000;

/** Deadline offset default (secondi). */
export const UNISWAP_V3_DEADLINE_SECONDS = 300;

/** QuoterV2 — Arbitrum Sepolia (quote off-chain via simulateContract). */
export const UNISWAP_V3_QUOTER_V2_ARBITRUM_SEPOLIA =
  "0x2779a0C1EFA37FB27C5B2FceD20B0D1EB508778C" as Address;

/** USDC nativo Sepolia (6 decimali) — pair liquido con WETH. */
export const ARBITRUM_SEPOLIA_USDC =
  "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address;

/** WETH nativo Sepolia (18 decimali). */
export const ARBITRUM_SEPOLIA_WETH =
  "0x1bdc540dEB9Ed1fA29964DeEcCc524A8f5e2198e" as Address;

/** MockDexRouter Anvil — nessun Quoter; slippage min ignorato in locale. */
export const MOCK_DEX_ROUTER_ANVIL =
  "0xe7f1725E7734CE288F8367e1bb143E90bb3F0512" as Address;

/** Slippage default sul amountOut del Quoter (basis points). 50 = 0.5%. */
export const UNISWAP_V3_DEFAULT_SLIPPAGE_BPS = 50n;

export function defaultUniswapV3Quoter(chainId: number): Address | null {
  if (chainId === 421614) return UNISWAP_V3_QUOTER_V2_ARBITRUM_SEPOLIA;
  return null;
}

export function isMockDexRouterAddress(router: Address): boolean {
  return router.toLowerCase() === MOCK_DEX_ROUTER_ANVIL.toLowerCase();
}

export function defaultUniswapV3Router(chainId: number): Address {
  if (chainId === 421614) return UNISWAP_V3_SWAP_ROUTER02_ARBITRUM_SEPOLIA;
  if (chainId === 1 || chainId === 42161) return UNISWAP_V3_SWAP_ROUTER02_MAINNET;
  return UNISWAP_V3_SWAP_ROUTER02_MAINNET;
}
