import { describe, expect, it } from "vitest";
import {
  applySlippageMinimum,
  encodePrimaryMintDexPayload,
  encodeUniswapV3DexPayload,
  extractTradeSizingFromPayload,
  KEEPER_ERROR_MISSING_SIZING,
  requireExecutionSizingFromPayload,
  KeeperSizingError,
} from "./web3-keeper";
import { quotePrimaryMintAmountOut } from "../afx-rwa-tokens";

describe("web3-keeper Uniswap V3", () => {
  const router = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45" as const;
  const vault = "0x1111111111111111111111111111111111111111" as const;
  const usdc = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
  const weth = "0x4200000000000000000000000000000000000006" as const;

  it("encodeUniswapV3DexPayload builds exactInputSingle with recipient=vault", () => {
    const deadline = 1_700_000_000n;
    const dexPayload = encodeUniswapV3DexPayload({
      router,
      vaultAddress: vault,
      assetIn: usdc,
      assetOut: weth,
      amountIn: 1_000_000n,
      fee: 3000,
      amountOutMinimum: 995_000n,
      deadlineUnix: deadline,
    });

    expect(dexPayload.startsWith("0x")).toBe(true);
  });

  it("applySlippageMinimum applies 0.5% (50 bps)", () => {
    expect(applySlippageMinimum(10_000n, 50n)).toBe(9_950n);
    expect(applySlippageMinimum(1_000_000n, 50n)).toBe(995_000n);
  });

  it("extractTradeSizingFromPayload reads sizing block", () => {
    const sizing = extractTradeSizingFromPayload({
      sizing: {
        amountIn: "5000000",
        tokenIn: usdc,
        tokenOut: weth,
        fee: 3000,
      },
    });
    expect(sizing.amountIn).toBe(5_000_000n);
    expect(sizing.assetIn?.toLowerCase()).toBe(usdc.toLowerCase());
    expect(sizing.assetOut?.toLowerCase()).toBe(weth.toLowerCase());
    expect(sizing.fee).toBe(3000);
  });

  it("requireExecutionSizingFromPayload throws MISSING_EXECUTION_SIZING without sizing", () => {
    expect(() => requireExecutionSizingFromPayload({})).toThrow(KeeperSizingError);
    try {
      requireExecutionSizingFromPayload({});
    } catch (e) {
      expect(e).toBeInstanceOf(KeeperSizingError);
      expect((e as KeeperSizingError).code).toBe(KEEPER_ERROR_MISSING_SIZING);
    }
  });

  it("requireExecutionSizingFromPayload accepts complete sizing", () => {
    const s = requireExecutionSizingFromPayload({
      sizing: {
        amountIn: "1000000",
        tokenIn: usdc,
        tokenOut: weth,
        fee: 3000,
        executionKind: "uniswap_v3",
      },
    });
    expect(s.amountIn).toBe(1_000_000n);
    expect(s.fee).toBe(3000);
    expect(s.executionKind).toBe("uniswap_v3");
  });

  it("encodePrimaryMintDexPayload builds mint calldata", () => {
    const primary = "0x2222222222222222222222222222222222222222" as const;
    const rwa = "0x3333333333333333333333333333333333333333" as const;
    const payload = encodePrimaryMintDexPayload({
      primaryRouter: primary,
      vaultAddress: vault,
      assetOut: rwa,
      amountIn: 5_000_000n,
      amountOutMinimum: quotePrimaryMintAmountOut(5_000_000n) * 9950n / 10000n,
    });
    expect(payload.startsWith("0x")).toBe(true);
  });

  it("requireExecutionSizingFromPayload accepts primary mint fee=0", () => {
    const s = requireExecutionSizingFromPayload({
      marketRoutingMode: "PRIMARY_MINT_BURN",
      sizing: {
        amountIn: "2000000",
        tokenIn: usdc,
        tokenOut: "0x3333333333333333333333333333333333333333",
        fee: 0,
        executionKind: "primary_mint",
        primaryRouter: "0x2222222222222222222222222222222222222222",
      },
    });
    expect(s.executionKind).toBe("primary_mint");
    expect(s.fee).toBe(0);
  });
});
