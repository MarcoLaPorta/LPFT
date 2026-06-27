/**
 * Sweeper: ExecutionLog in SUBMITTED (o PENDING legacy) → CONFIRMED / FAILED (mock on-chain).
 * One-shot o loop: SWEEP_INTERVAL_MS > 0 per ripetere.
 *
 * DATABASE_URL=... npm run sweep
 */
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: `${process.cwd()}/.env` });

const prisma = new PrismaClient();
const INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? "0");

async function sweepOnce(): Promise<number> {
  const pending = await prisma.executionLog.findMany({
    where: { executionStatus: { in: ["SUBMITTED", "PENDING"] } },
    take: 100,
    orderBy: { createdAt: "asc" },
  });
  let n = 0;
  for (const row of pending) {
    const ok = Math.random() > 0.05;
    const basePnl =
      row.pnlResult && typeof row.pnlResult === "object" && !Array.isArray(row.pnlResult)
        ? (row.pnlResult as Record<string, unknown>)
        : {};
    await prisma.executionLog.update({
      where: { id: row.id },
      data: ok
        ? {
            executionStatus: "CONFIRMED",
            transactionHash: `0xmock${row.id.replace(/-/g, "").slice(0, 10)}`,
            confirmedBlock: BigInt(18_000_000 + n),
          }
        : {
            executionStatus: "FAILED",
            pnlResult: { ...basePnl, mock_error: "onchain_revert" },
          },
    });
    n += 1;
  }
  if (n) console.log(`sweeper: updated ${n} rows`);
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
