/**
 * Keeper / Sweeper: ExecutionLog SUBMITTED (o PENDING) → CONFIRMED / FAILED.
 * - AFX_ONCHAIN_CONFIRM_MODE=mock — hash mock (dev senza Anvil)
 * - AFX_ONCHAIN_CONFIRM_MODE=real — viem MANAGER → SmartVault.executeTrade
 *
 * DATABASE_URL=... npm run keeper
 * Loop: SWEEP_INTERVAL_MS=5000 npm run keeper:loop
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

config({ path: path.join(webRoot, ".env.local") });
config({ path: path.join(webRoot, ".env") });

const prisma = new PrismaClient();
const INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? "0");
const ONCHAIN_CONFIRM_MODE = (process.env.AFX_ONCHAIN_CONFIRM_MODE ?? "mock").trim().toLowerCase();

type PendingExecutionLog = {
  id: string;
  pnlResult: unknown;
};

type ConfirmOnChainResult = {
  ok: boolean;
  transactionHash?: string;
  confirmedBlock?: bigint;
  errorCode?: string;
};

function confirmOnChainMock(row: PendingExecutionLog, index: number): ConfirmOnChainResult {
  const ok = Math.random() > 0.05;
  if (!ok) {
    return { ok: false, errorCode: "onchain_revert" };
  }
  return {
    ok: true,
    transactionHash: `0xmock${row.id.replace(/-/g, "").slice(0, 10)}`,
    confirmedBlock: BigInt(18_000_000 + index),
  };
}

async function confirmOnChainReal(row: PendingExecutionLog): Promise<ConfirmOnChainResult> {
  const { confirmExecutionOnChain } = await import("../lib/services/web3-keeper");
  const full = await prisma.executionLog.findUnique({ where: { id: row.id } });
  if (!full) return { ok: false, errorCode: "row_missing" };
  return confirmExecutionOnChain(full);
}

async function confirmOnChain(
  row: PendingExecutionLog,
  index: number,
): Promise<ConfirmOnChainResult> {
  if (ONCHAIN_CONFIRM_MODE === "real") {
    return confirmOnChainReal(row);
  }
  return confirmOnChainMock(row, index);
}

async function sweepOnce(): Promise<number> {
  const pending = await prisma.executionLog.findMany({
    where: { executionStatus: { in: ["SUBMITTED", "PENDING"] } },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  let n = 0;
  for (const row of pending) {
    const result = await confirmOnChain(row, n);
    const basePnl =
      row.pnlResult && typeof row.pnlResult === "object" && !Array.isArray(row.pnlResult)
        ? (row.pnlResult as Record<string, unknown>)
        : {};
    await prisma.executionLog.update({
      where: { id: row.id },
      data: result.ok
        ? {
            executionStatus: "CONFIRMED",
            transactionHash: result.transactionHash,
            confirmedBlock: result.confirmedBlock,
          }
        : {
            executionStatus: "FAILED",
            pnlResult: {
              ...basePnl,
              keeper_error: result.errorCode ?? "onchain_revert",
              failedAt: new Date().toISOString(),
            },
          },
    });
    n += 1;
  }
    if (n) console.log(`sweeper: updated ${n} rows (mode=${ONCHAIN_CONFIRM_MODE})`);
  return n;
}

async function main(): Promise<void> {
  if (INTERVAL_MS > 0) {
    console.log(`sweeper: loop every ${INTERVAL_MS}ms`);
    for (;;) {
      await sweepOnce();
      await new Promise((r) => setTimeout(r, INTERVAL_MS));
    }
  } else {
    await sweepOnce();
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
