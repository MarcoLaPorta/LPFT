import { NextResponse } from "next/server";
import { getOrCreateUserByWallet } from "../../../../lib/afx-user";
import { extractSizingFromPayload } from "../../../../lib/execution-user-sizing";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/execution/:id?wallet=0x… — stato ExecutionLog (polling SWR).
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim().toLowerCase();
  if (!wallet) {
    return NextResponse.json({ error: "wallet query required" }, { status: 400 });
  }

  const user = await getOrCreateUserByWallet(wallet);

  const row = await prisma.executionLog.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      executionStatus: true,
      transactionHash: true,
      actionType: true,
      updatedAt: true,
      payloadJson: true,
    },
  });

  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const payload =
    row.payloadJson && typeof row.payloadJson === "object" && !Array.isArray(row.payloadJson)
      ? (row.payloadJson as Record<string, unknown>)
      : null;

  return NextResponse.json({
    id: row.id,
    executionStatus: row.executionStatus,
    transactionHash: row.transactionHash,
    actionType: row.actionType,
    updatedAt: row.updatedAt.toISOString(),
    sizing: extractSizingFromPayload(payload),
  });
}
