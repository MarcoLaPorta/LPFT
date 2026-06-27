import type { ExecutionLog } from "@prisma/client";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  isAddress,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { readContract, simulateContract } from "viem/actions";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { quotePrimaryMintAmountOut } from "../afx-rwa-tokens";
import { uniswapV3QuoterV2Abi, uniswapV3SwapRouterAbi, smartVaultAbi, mockRwaPrimaryAbi } from "../web3/abis";
import { anvilLocal } from "../web3/chains";
import {
  defaultUniswapV3Quoter,
  defaultUniswapV3Router,
  isMockDexRouterAddress,
  UNISWAP_V3_DEADLINE_SECONDS,
  UNISWAP_V3_DEFAULT_SLIPPAGE_BPS,
  UNISWAP_V3_FEE_TIER_3000,
} from "../web3/uniswap-v3";
import { prisma } from "../prisma";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Keeper: sizing mancante in ExecutionLog.payloadJson */
export const KEEPER_ERROR_MISSING_SIZING = "MISSING_EXECUTION_SIZING";

/** Keeper: QuoterV2 non ha restituito quote (liquidità testnet / pool assente). */
export const KEEPER_ERROR_QUOTER_LIQUIDITY = "INSUFFICIENT_LIQUIDITY_FOR_QUOTER";

export type Web3SubmissionPayload = {
  kind: "web3_execute_trade_v1";
  chainId: number;
  vaultAddress: Address;
  assetIn: Address;
  assetOut: Address;
  amount: string;
  routerAddress: Address;
  dexPayload: Hex;
  swapMeta?: {
    protocol: "uniswap_v3" | "mock_dex" | "primary_mint";
    fee: number;
    amountOutQuoted: string;
    amountOutMinimum: string;
    slippageBps: string;
    deadline: string;
    quoterAddress?: string;
    marketRoutingMode?: string;
    executionKind?: string;
  };
};

export type KeeperConfirmResult = {
  ok: boolean;
  transactionHash?: string;
  confirmedBlock?: bigint;
  errorCode?: string;
};

export type UniswapV3SwapParams = {
  router: Address;
  vaultAddress: Address;
  assetIn: Address;
  assetOut: Address;
  amountIn: bigint;
  fee?: number;
  amountOutMinimum: bigint;
  deadlineUnix?: bigint;
};

export type ExecutionSizingRequired = {
  amountIn: bigint;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  executionKind: "uniswap_v3" | "primary_mint";
  primaryRouter?: Address;
  marketRoutingMode?: string;
};

export class KeeperSizingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "KeeperSizingError";
    this.code = code;
  }
}

function envAddress(...keys: string[]): Address | null {
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v && isAddress(v)) return v;
  }
  return null;
}

export function getKeeperRpcUrl(chainId: number): string {
  if (chainId === anvilLocal.id) {
    return (
      process.env.AFX_RPC_URL?.trim() ??
      process.env.NEXT_PUBLIC_RPC_LOCAL?.trim() ??
      "http://127.0.0.1:8545"
    );
  }
  if (chainId === arbitrumSepolia.id) {
    return (
      process.env.ARBITRUM_SEPOLIA_RPC_URL?.trim() ??
      process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC?.trim() ??
      process.env.AFX_RPC_URL?.trim() ??
      "https://sepolia-rollup.arbitrum.io/rpc"
    );
  }
  const generic = process.env.AFX_RPC_URL?.trim();
  if (generic) return generic;
  throw new Error(`RPC non configurato per chainId=${chainId}`);
}

export function getManagerPrivateKey(): Hex {
  const raw =
    process.env.MANAGER_PRIVATE_KEY?.trim() ??
    process.env.AFX_MANAGER_PRIVATE_KEY?.trim();
  if (!raw?.startsWith("0x") || raw.length < 66) {
    throw new Error(
      "MANAGER_PRIVATE_KEY (o AFX_MANAGER_PRIVATE_KEY) richiesto per il keeper on-chain",
    );
  }
  return raw as Hex;
}

/** Applica slippage in bps su amountOut (BigInt): min = amountOut * (10000 - bps) / 10000 */
export function applySlippageMinimum(
  amountOut: bigint,
  slippageBps: bigint = UNISWAP_V3_DEFAULT_SLIPPAGE_BPS,
): bigint {
  if (amountOut <= 0n) return 0n;
  if (slippageBps <= 0n) return amountOut;
  if (slippageBps >= 10000n) return 0n;
  return (amountOut * (10000n - slippageBps)) / 10000n;
}

function parseBigIntField(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.floor(value));
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
}

function parseAddressField(value: unknown): Address | null {
  if (typeof value === "string" && isAddress(value)) return value;
  return null;
}

function parseFeeField(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function parseExecutionKind(payload: Record<string, unknown>): "uniswap_v3" | "primary_mint" {
  const sizing =
    payload.sizing && typeof payload.sizing === "object" && !Array.isArray(payload.sizing)
      ? (payload.sizing as Record<string, unknown>)
      : null;
  if (sizing?.executionKind === "primary_mint") return "primary_mint";
  const mode = payload.marketRoutingMode ?? sizing?.marketRoutingMode;
  if (mode === "PRIMARY_MINT_BURN" || mode === "PRIMARY_RFQ_ATOMIC") return "primary_mint";
  return "uniswap_v3";
}

/**
 * Estrae campi sizing dal payload (solo lettura; non valida completezza).
 */
export function extractTradeSizingFromPayload(payload: Record<string, unknown>): {
  amountIn: bigint | null;
  assetIn: Address | null;
  assetOut: Address | null;
  fee: number | null;
} {
  const sizing =
    payload.sizing && typeof payload.sizing === "object" && !Array.isArray(payload.sizing)
      ? (payload.sizing as Record<string, unknown>)
      : null;

  const amountIn =
    parseBigIntField(sizing?.amountIn) ?? parseBigIntField(sizing?.amount_in);
  const assetIn =
    parseAddressField(sizing?.tokenIn) ??
    parseAddressField(sizing?.assetIn) ??
    parseAddressField(sizing?.token_in);
  const assetOut =
    parseAddressField(sizing?.tokenOut) ??
    parseAddressField(sizing?.assetOut) ??
    parseAddressField(sizing?.token_out);
  const fee = parseFeeField(sizing?.fee);

  return { amountIn, assetIn, assetOut, fee };
}

/**
 * Richiede sizing completo in payloadJson — nessun fallback env.
 * @throws KeeperSizingError
 */
export function requireExecutionSizingFromPayload(
  payload: Record<string, unknown>,
): ExecutionSizingRequired {
  const { amountIn, assetIn, assetOut, fee } = extractTradeSizingFromPayload(payload);
  const executionKind = parseExecutionKind(payload);
  const sizing =
    payload.sizing && typeof payload.sizing === "object" && !Array.isArray(payload.sizing)
      ? (payload.sizing as Record<string, unknown>)
      : null;
  const primaryRouterRaw =
    typeof sizing?.primaryRouter === "string" && isAddress(sizing.primaryRouter)
      ? (sizing.primaryRouter as Address)
      : undefined;
  const marketRoutingMode =
    typeof payload.marketRoutingMode === "string"
      ? payload.marketRoutingMode
      : typeof sizing?.marketRoutingMode === "string"
        ? sizing.marketRoutingMode
        : undefined;

  if (amountIn == null || amountIn <= 0n) {
    throw new KeeperSizingError(
      KEEPER_ERROR_MISSING_SIZING,
      "payloadJson.sizing.amountIn mancante o non valido (motore quant obbligatorio).",
    );
  }
  if (!assetIn) {
    throw new KeeperSizingError(
      KEEPER_ERROR_MISSING_SIZING,
      "payloadJson.sizing.tokenIn / assetIn mancante.",
    );
  }
  if (!assetOut) {
    throw new KeeperSizingError(
      KEEPER_ERROR_MISSING_SIZING,
      "payloadJson.sizing.tokenOut / assetOut mancante.",
    );
  }

  if (executionKind === "primary_mint") {
    return {
      amountIn,
      tokenIn: assetIn,
      tokenOut: assetOut,
      fee: fee ?? 0,
      executionKind,
      primaryRouter: primaryRouterRaw,
      marketRoutingMode,
    };
  }

  const poolFee = fee ?? UNISWAP_V3_FEE_TIER_3000;
  if (poolFee <= 0) {
    throw new KeeperSizingError(
      KEEPER_ERROR_MISSING_SIZING,
      "payloadJson.sizing.fee mancante o non valido (Uniswap).",
    );
  }

  return {
    amountIn,
    tokenIn: assetIn,
    tokenOut: assetOut,
    fee: poolFee,
    executionKind: "uniswap_v3",
    marketRoutingMode,
  };
}

function resolveViemChain(chainId: number, rpcUrl: string) {
  if (chainId === anvilLocal.id) return anvilLocal;
  if (chainId === arbitrumSepolia.id) return arbitrumSepolia;
  return {
    id: chainId,
    name: "afx",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
}

function parseQuoterAmountOut(result: unknown): bigint {
  if (typeof result === "bigint") return result;
  if (Array.isArray(result) && typeof result[0] === "bigint") return result[0];
  return 0n;
}

/**
 * QuoterV2.quoteExactInputSingle (off-chain eth_call).
 * Prova readContract; su Quoter revert-based usa simulateContract come fallback eth_call.
 */
export async function quoteUniswapV3AmountOut(args: {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  fee: number;
}): Promise<bigint> {
  const quoter = defaultUniswapV3Quoter(args.chainId);
  if (!quoter) {
    throw new KeeperSizingError(
      KEEPER_ERROR_QUOTER_LIQUIDITY,
      `QuoterV2 non configurato per chainId=${args.chainId}`,
    );
  }

  const rpcUrl = getKeeperRpcUrl(args.chainId);
  const chain = resolveViemChain(args.chainId, rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  const quoteParams = {
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    fee: args.fee,
    sqrtPriceLimitX96: 0n,
  } as const;

  try {
    let amountOut = 0n;
    try {
      const readResult = await readContract(publicClient, {
        address: quoter,
        abi: uniswapV3QuoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [quoteParams],
      });
      amountOut = parseQuoterAmountOut(readResult);
    } catch (readErr) {
      const { result } = await simulateContract(publicClient, {
        address: quoter,
        abi: uniswapV3QuoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [quoteParams],
      });
      amountOut = parseQuoterAmountOut(result);
      if (readErr instanceof Error) {
        console.warn(
          `[keeper] Quoter readContract fallback simulate chain=${args.chainId}:`,
          readErr.message.slice(0, 120),
        );
      }
    }

    if (amountOut <= 0n) {
      throw new KeeperSizingError(
        KEEPER_ERROR_QUOTER_LIQUIDITY,
        "Quoter ha restituito amountOut zero.",
      );
    }
    return amountOut;
  } catch (e) {
    if (e instanceof KeeperSizingError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[keeper] QuoterV2 fallito chain=${args.chainId} in=${args.amountIn} fee=${args.fee}:`,
      msg,
    );
    throw new KeeperSizingError(
      KEEPER_ERROR_QUOTER_LIQUIDITY,
      `Insufficient Liquidity for Quoter: ${msg.slice(0, 200)}`,
    );
  }
}

async function resolveAmountOutMinimum(args: {
  chainId: number;
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  fee: number;
}): Promise<{ amountOutQuoted: bigint; amountOutMinimum: bigint; quoterAddress?: Address }> {
  if (isMockDexRouterAddress(args.router)) {
    return { amountOutQuoted: 0n, amountOutMinimum: 0n };
  }

  const quoter = defaultUniswapV3Quoter(args.chainId);
  const amountOutQuoted = await quoteUniswapV3AmountOut({
    chainId: args.chainId,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    fee: args.fee,
  });
  const amountOutMinimum = applySlippageMinimum(
    amountOutQuoted,
    UNISWAP_V3_DEFAULT_SLIPPAGE_BPS,
  );
  return { amountOutQuoted, amountOutMinimum, quoterAddress: quoter ?? undefined };
}

/**
 * Calldata Uniswap V3 SwapRouter02.exactInputSingle.
 * `recipient` = vault: i token out restano nel contratto vault.
 */
export function encodeUniswapV3DexPayload(params: UniswapV3SwapParams): Hex {
  const fee = params.fee ?? UNISWAP_V3_FEE_TIER_3000;
  const deadline =
    params.deadlineUnix ??
    BigInt(Math.floor(Date.now() / 1000) + UNISWAP_V3_DEADLINE_SECONDS);

  const swapCalldata = encodeFunctionData({
    abi: uniswapV3SwapRouterAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: params.assetIn,
        tokenOut: params.assetOut,
        fee,
        recipient: params.vaultAddress,
        deadline,
        amountIn: params.amountIn,
        amountOutMinimum: params.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  return encodeAbiParameters(parseAbiParameters("address, bytes"), [
    params.router,
    swapCalldata,
  ]);
}

/** Calldata MockRwaPrimary.mintRwa — mercato primario testnet. */
export function encodePrimaryMintDexPayload(params: {
  primaryRouter: Address;
  vaultAddress: Address;
  assetOut: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
}): Hex {
  const mintCalldata = encodeFunctionData({
    abi: mockRwaPrimaryAbi,
    functionName: "mintRwa",
    args: [params.assetOut, params.vaultAddress, params.amountIn, params.amountOutMinimum],
  });
  return encodeAbiParameters(parseAbiParameters("address, bytes"), [
    params.primaryRouter,
    mintCalldata,
  ]);
}

/** @deprecated Usa encodeUniswapV3DexPayload. */
export function encodeDexPayload(
  router: Address,
  vaultAddress: Address,
  assetIn: Address,
  assetOut: Address,
  amountIn: bigint,
): Hex {
  return encodeUniswapV3DexPayload({
    router,
    vaultAddress,
    assetIn,
    assetOut,
    amountIn,
    amountOutMinimum: 0n,
  });
}

function payloadRecord(row: ExecutionLog): Record<string, unknown> {
  if (row.payloadJson && typeof row.payloadJson === "object" && !Array.isArray(row.payloadJson)) {
    return row.payloadJson as Record<string, unknown>;
  }
  return {};
}

async function resolveVaultForUser(
  userId: string,
  chainId: number,
): Promise<Address | null> {
  const vault = await prisma.smartVault.findFirst({
    where: { userId, chainId, status: "ACTIVE" },
    orderBy: { deployedAt: "desc" },
    select: { vaultAddress: true },
  });
  if (!vault?.vaultAddress || !isAddress(vault.vaultAddress)) return null;
  return vault.vaultAddress as Address;
}

async function isRouterWhitelisted(chainId: number, router: string): Promise<boolean> {
  const rows = await prisma.whitelistedDexRouter.findMany({
    where: { chainId, active: true },
    select: { address: true },
  });
  const norm = router.toLowerCase();
  return rows.some((r) => r.address.toLowerCase() === norm);
}

/** Costruisce payload keeper con Quoter + slippage 0.5%. Richiede payloadJson.sizing. */
export async function buildWeb3SubmissionPayload(args: {
  userId: string;
  chainId?: number;
  routerAddress?: string | null;
  payloadJson?: Record<string, unknown>;
}): Promise<{ payload: Web3SubmissionPayload } | { error: string; errorCode?: string }> {
  if (!args.payloadJson) {
    return {
      error: "payloadJson assente: sizing dal motore quant obbligatorio.",
      errorCode: KEEPER_ERROR_MISSING_SIZING,
    };
  }

  let sizing: ExecutionSizingRequired;
  try {
    sizing = requireExecutionSizingFromPayload(args.payloadJson);
  } catch (e) {
    if (e instanceof KeeperSizingError) {
      return { error: e.message, errorCode: e.code };
    }
    throw e;
  }

  const chainId =
    args.chainId ??
    Number(process.env.AFX_CHAIN_ID ?? process.env.NEXT_PUBLIC_AFX_CHAIN_ID ?? anvilLocal.id);

  const vaultAddress = await resolveVaultForUser(args.userId, chainId);
  if (!vaultAddress) {
    return {
      error: "Nessun SmartVault ACTIVE per l'utente su questa chain. Crea il vault da /vault.",
    };
  }

  const { amountIn, tokenIn, tokenOut, fee, executionKind, marketRoutingMode } = sizing;
  const deadlineUnix = BigInt(Math.floor(Date.now() / 1000) + UNISWAP_V3_DEADLINE_SECONDS);

  if (executionKind === "primary_mint") {
    const primaryRouter =
      sizing.primaryRouter ??
      envAddress("AFX_RWA_PRIMARY_ADDRESS", "NEXT_PUBLIC_AFX_RWA_PRIMARY_ADDRESS");
    if (!primaryRouter) {
      return {
        error: "MockRwaPrimary non configurato (AFX_RWA_PRIMARY_ADDRESS).",
        errorCode: KEEPER_ERROR_MISSING_SIZING,
      };
    }
    const whitelistedPrimary = await isRouterWhitelisted(chainId, primaryRouter);
    if (!whitelistedPrimary) {
      return {
        error: `Router primario ${primaryRouter} non in whitelist DB. Esegui npm run seed:web3.`,
      };
    }

    let amountOutQuoted = quotePrimaryMintAmountOut(amountIn);
    let slippageBps = UNISWAP_V3_DEFAULT_SLIPPAGE_BPS;
    if (marketRoutingMode === "PRIMARY_RFQ_ATOMIC") {
      slippageBps = slippageBps + 30n;
    }
    const amountOutMinimum = applySlippageMinimum(amountOutQuoted, slippageBps);

    const dexPayload = encodePrimaryMintDexPayload({
      primaryRouter,
      vaultAddress,
      assetOut: tokenOut,
      amountIn,
      amountOutMinimum,
    });

    return {
      payload: {
        kind: "web3_execute_trade_v1",
        chainId,
        vaultAddress,
        assetIn: tokenIn,
        assetOut: tokenOut,
        amount: amountIn.toString(),
        routerAddress: primaryRouter,
        dexPayload,
        swapMeta: {
          protocol: "primary_mint",
          fee: 0,
          amountOutQuoted: amountOutQuoted.toString(),
          amountOutMinimum: amountOutMinimum.toString(),
          slippageBps: slippageBps.toString(),
          deadline: deadlineUnix.toString(),
          marketRoutingMode,
          executionKind,
        },
      },
    };
  }

  const routerAddress =
    (args.routerAddress && isAddress(args.routerAddress) ? args.routerAddress : null) ??
    envAddress("AFX_DEX_ROUTER_ADDRESS", "NEXT_PUBLIC_AFX_DEX_ROUTER_ADDRESS") ??
    defaultUniswapV3Router(chainId);

  if (!routerAddress) {
    return { error: "Router DEX non configurato (AFX_DEX_ROUTER_ADDRESS)." };
  }

  const whitelisted = await isRouterWhitelisted(chainId, routerAddress);
  if (!whitelisted) {
    return {
      error: `Router ${routerAddress} non in whitelist DB (chain ${chainId}). Esegui npm run seed:web3.`,
    };
  }

  let amountOutQuoted = 0n;
  let amountOutMinimum = 0n;
  let quoterAddress: Address | undefined;
  const isMock = isMockDexRouterAddress(routerAddress);

  if (!isMock) {
    try {
      const quoted = await resolveAmountOutMinimum({
        chainId,
        router: routerAddress,
        tokenIn,
        tokenOut,
        amountIn,
        fee,
      });
      amountOutQuoted = quoted.amountOutQuoted;
      amountOutMinimum = quoted.amountOutMinimum;
      quoterAddress = quoted.quoterAddress;
    } catch (e) {
      if (e instanceof KeeperSizingError) {
        return { error: e.message, errorCode: e.code };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { error: msg, errorCode: KEEPER_ERROR_QUOTER_LIQUIDITY };
    }
  }

  const dexPayload = encodeUniswapV3DexPayload({
    router: routerAddress,
    vaultAddress,
    assetIn: tokenIn,
    assetOut: tokenOut,
    amountIn,
    fee,
    amountOutMinimum,
    deadlineUnix,
  });

  return {
    payload: {
      kind: "web3_execute_trade_v1",
      chainId,
      vaultAddress,
      assetIn: tokenIn,
      assetOut: tokenOut,
      amount: amountIn.toString(),
      routerAddress,
      dexPayload,
      swapMeta: {
        protocol: isMock ? "mock_dex" : "uniswap_v3",
        fee,
        amountOutQuoted: amountOutQuoted.toString(),
        amountOutMinimum: amountOutMinimum.toString(),
        slippageBps: UNISWAP_V3_DEFAULT_SLIPPAGE_BPS.toString(),
        deadline: deadlineUnix.toString(),
        quoterAddress,
        marketRoutingMode: marketRoutingMode ?? "SECONDARY_AMM",
        executionKind: "uniswap_v3",
      },
    },
  };
}

export async function resolveWeb3Intent(
  row: ExecutionLog,
): Promise<Web3SubmissionPayload | { error: string; errorCode?: string }> {
  const payload = payloadRecord(row);
  const chainId = row.chainId ?? Number(process.env.AFX_CHAIN_ID ?? anvilLocal.id);

  const built = await buildWeb3SubmissionPayload({
    userId: row.userId,
    chainId,
    routerAddress: row.routerAddress,
    payloadJson: payload,
  });
  if ("error" in built) return built;
  return built.payload;
}

function formatKeeperError(e: unknown): string {
  if (e instanceof KeeperSizingError) return `${e.code}: ${e.message}`;
  if (e instanceof Error) {
    const parts = [e.name, e.message];
    const cause = e.cause;
    if (cause instanceof Error) parts.push(cause.message);
    return parts.join(": ").slice(0, 500);
  }
  return String(e).slice(0, 500);
}

/** MANAGER: SmartVault.executeTrade → attende receipt → CONFIRMED / FAILED. */
export async function confirmExecutionOnChain(row: ExecutionLog): Promise<KeeperConfirmResult> {
  let intent: Web3SubmissionPayload | { error: string; errorCode?: string };
  try {
    intent = await resolveWeb3Intent(row);
  } catch (e) {
    const code =
      e instanceof KeeperSizingError ? e.code : KEEPER_ERROR_MISSING_SIZING;
    const msg = formatKeeperError(e);
    console.error(`[keeper] resolve intent failed id=${row.id}`, msg);
    return { ok: false, errorCode: code };
  }

  if ("error" in intent) {
    console.error(`[keeper] resolve intent failed id=${row.id}`, intent.error);
    return {
      ok: false,
      errorCode: intent.errorCode ?? KEEPER_ERROR_MISSING_SIZING,
    };
  }

  try {
    const account = privateKeyToAccount(getManagerPrivateKey());
    const rpcUrl = getKeeperRpcUrl(intent.chainId);
    const chain = resolveViemChain(intent.chainId, rpcUrl);

    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

    console.log(
      `[keeper] executeTrade id=${row.id} vault=${intent.vaultAddress} amount=${intent.amount} ` +
        `minOut=${intent.swapMeta?.amountOutMinimum ?? "?"} router=${intent.routerAddress}`,
    );

    const hash = await walletClient.writeContract({
      address: intent.vaultAddress,
      abi: smartVaultAbi,
      functionName: "executeTrade",
      args: [
        intent.assetIn,
        intent.assetOut,
        BigInt(intent.amount),
        intent.dexPayload,
      ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      const msg = `tx_reverted hash=${hash}`;
      console.error(`[keeper] ${msg} id=${row.id}`);
      return { ok: false, errorCode: msg, transactionHash: hash };
    }

    console.log(`[keeper] CONFIRMED id=${row.id} hash=${hash} block=${receipt.blockNumber}`);
    return {
      ok: true,
      transactionHash: hash,
      confirmedBlock: receipt.blockNumber,
    };
  } catch (e) {
    const msg = formatKeeperError(e);
    console.error(`[keeper] FAILED id=${row.id}`, msg);
    if (msg.toLowerCase().includes("too little received")) {
      console.error(`[keeper] Uniswap slippage / liquidity: ${msg}`);
    }
    return { ok: false, errorCode: msg };
  }
}
