import { displayUsdcToRaw, isValidUsdcDisplay, rawUsdcToDisplay } from "../../lib/execution-user-sizing";

export function executionSizingLabel(sizing: {
  executionKind?: string;
  marketRoutingMode?: string;
  tokenOutSymbol?: string;
  symbol?: string;
} | null | undefined): string {
  if (!sizing) return "Caricamento parametri esecuzione…";
  if (sizing.executionKind === "primary_mint") {
    const mode =
      sizing.marketRoutingMode === "PRIMARY_RFQ_ATOMIC"
        ? "RFQ primario"
        : "Mint primario";
    return `${mode}: USDC → ${sizing.tokenOutSymbol ?? "RWA"} (${sizing.symbol ?? "equity"}) · slippage 0.5%`;
  }
  return `Swap crypto: USDC → ${sizing.tokenOutSymbol ?? "WETH"} · Uniswap 0.3% · slippage 0.5%`;
}

export { displayUsdcToRaw, isValidUsdcDisplay, rawUsdcToDisplay };
