/**
 * Consumer Redis: messaggi pubblicati da `lpft_api/intent_publisher.py` (LPFT_AFX_INTENTS_ENABLED)
 * → crea `ExecutionLog` in Prisma (stesso DATABASE_URL di Next).
 *
 * LPFT_REDIS_URL=redis://localhost:6379/0 DATABASE_URL=... npm run worker:intents
 *
 * Regole:
 * - `router_address` + `chain_id` entrambi valorizzati: devono esistere in `WhitelistedDexRouter` (active),
 *   altrimenti il messaggio viene scartato (log di warning).
 * - Se router/chain mancanti (tipico flusso LPFT oggi): `ExecutionLog` con stato LOGGED_PROPOSAL (audit).
 * - Se whitelist ok: stato PENDING (compatibile con `npm run sweep`).
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, type MarketRoutingMode, type Prisma } from "@prisma/client";
import { createClient } from "redis";
import { z } from "zod";

import { getOrCreateUserByWallet } from "../lib/afx-user";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

config({ path: path.join(webRoot, ".env.local") });
config({ path: path.join(webRoot, ".env") });

const prisma = new PrismaClient();

const ROUTING_MODES: MarketRoutingMode[] = [
  "PRIMARY_MINT_BURN",
  "PRIMARY_RFQ_ATOMIC",
  "SECONDARY_AMM",
];

const intentPayloadV1 = z.object({
  version: z.number().int().positive(),
  idempotency_key: z.string().min(1),
  user_prompt: z.string(),
  ai_reasoning: z.string(),
  strategy_spec: z.unknown(),
  symbol: z.string().nullable().optional(),
  wallet_address: z.string().nullable().optional(),
  router_address: z.string().nullable().optional(),
  chain_id: z.number().int().nullable().optional(),
  market_routing_mode: z.string().optional(),
  model_id: z.string().nullable().optional(),
});

function normalizeIdempotencyKey(key: string): string {
  const k = key.trim();
  if (k.length <= 64) return k;
  return createHash("sha256").update(k, "utf8").digest("hex");
}

function parseMarketRoutingMode(raw: string | undefined): MarketRoutingMode {
  const v = (raw ?? "SECONDARY_AMM").trim().toUpperCase();
  if (ROUTING_MODES.includes(v as MarketRoutingMode)) return v as MarketRoutingMode;
  return "SECONDARY_AMM";
}

function normalizeAddr(a: string): string {
  return a.trim().toLowerCase();
}

async function routerWhitelisted(chainId: number, routerAddress: string): Promise<boolean> {
  const addr = normalizeAddr(routerAddress);
  const rows = await prisma.whitelistedDexRouter.findMany({
    where: { chainId, active: true },
    select: { address: true },
  });
  return rows.some((r) => r.address.toLowerCase() === addr);
}

async function handleRawMessage(raw: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    console.warn("[intent-listener] skip: invalid JSON");
    return;
  }

  const parsedV = intentPayloadV1.safeParse(parsed);
  if (!parsedV.success) {
    console.warn("[intent-listener] skip: schema", parsedV.error.flatten());
    return;
  }
  const data = parsedV.data;
  if (data.version !== 1) {
    console.warn(`[intent-listener] skip: unsupported version ${data.version}`);
    return;
  }

  const idempotencyKey = normalizeIdempotencyKey(data.idempotency_key);

  const dup = await prisma.executionLog.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (dup) {
    console.log(`[intent-listener] duplicate idempotency_key=${idempotencyKey.slice(0, 16)}… skip`);
    return;
  }

  const defaultWallet =
    process.env.AFX_INTENT_DEFAULT_WALLET?.trim() ||
    process.env.AFX_CHAT_DEFAULT_WALLET?.trim() ||
    process.env.NEXT_PUBLIC_AFX_DEFAULT_WALLET?.trim() ||
    "0x0000000000000000000000000000000000000001";

  const walletRaw = data.wallet_address?.trim();
  const wallet = walletRaw && walletRaw.startsWith("0x") ? walletRaw : defaultWallet;

  const routerRaw = data.router_address?.trim();
  const chainId = data.chain_id ?? null;
  let routerAddress: string | null = null;
  let executionStatus: "PENDING" | "LOGGED_PROPOSAL" = "LOGGED_PROPOSAL";

  if (routerRaw && chainId != null) {
    const ok = await routerWhitelisted(chainId, routerRaw);
    if (!ok) {
      console.warn(
        `[intent-listener] skip: router not whitelisted chain_id=${chainId} router=${routerRaw.slice(0, 12)}…`,
      );
      return;
    }
    routerAddress = normalizeAddr(routerRaw);
    executionStatus = "PENDING";
  }

  const user = await getOrCreateUserByWallet(wallet);
  const marketRoutingMode = parseMarketRoutingMode(data.market_routing_mode);

  const pnlResult: Prisma.InputJsonValue = {
    basis: "lpft_redis_intent",
    symbol: data.symbol ?? null,
    receivedAt: new Date().toISOString(),
  };

  const payloadJson = JSON.parse(
    JSON.stringify({
      source: "lpft_api.intent_publisher",
      strategy_spec: data.strategy_spec,
      symbol: data.symbol ?? null,
      router_address: data.router_address ?? null,
      chain_id: data.chain_id ?? null,
    }),
  ) as Prisma.InputJsonValue;

  try {
    await prisma.executionLog.create({
      data: {
        idempotencyKey,
        userId: user.id,
        userPrompt: data.user_prompt || "(empty)",
        aiReasoning: data.ai_reasoning || "",
        pnlResult,
        marketRoutingMode,
        executionStatus,
        actionType: "lpft_executable_intent",
        payloadJson,
        routerAddress,
        chainId,
        modelId: data.model_id ?? null,
      },
    });
    console.log(
      `[intent-listener] created ExecutionLog status=${executionStatus} idempotency=${idempotencyKey.slice(0, 16)}…`,
    );
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "P2002") {
      console.log("[intent-listener] race duplicate idempotency, skip");
      return;
    }
    throw e;
  }
}

async function main(): Promise<void> {
  const redisUrl = process.env.LPFT_REDIS_URL ?? process.env.REDIS_URL;
  if (!redisUrl) {
    console.error("Missing LPFT_REDIS_URL or REDIS_URL");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL");
    process.exit(1);
  }

  const channel = process.env.AFX_INTENTS_CHANNEL?.trim() || "afx:intents:new";

  const client = createClient({ url: redisUrl });
  client.on("error", (err) => console.error("[intent-listener] Redis", err));

  await client.connect();
  console.log(`[intent-listener] subscribed ${channel} redis=${redisUrl.replace(/:[^:@/]+@/, ":****@")}`);

  const shutdown = async (signal: string) => {
    console.log(`[intent-listener] ${signal}, closing…`);
    try {
      await client.quit();
    } catch {
      /* ignore */
    }
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await client.subscribe(channel, (message) => {
    void handleRawMessage(message).catch((err) => {
      console.error("[intent-listener] handle error", err);
    });
  });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
