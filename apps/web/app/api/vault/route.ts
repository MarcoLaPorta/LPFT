import { NextResponse } from "next/server";
import { getOrCreateUserByWallet } from "../../../lib/afx-user";
import { prisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/vault?wallet=0x...
 * Lista SmartVault dell'utente (Phase C scaffold).
 */
export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim().toLowerCase();
  if (!wallet) {
    return NextResponse.json({ error: "wallet query required" }, { status: 400 });
  }

  const user = await getOrCreateUserByWallet(wallet);
  const rows = await prisma.smartVault.findMany({
    where: { userId: user.id },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      chainId: true,
      vaultAddress: true,
      managerAddress: true,
      status: true,
      deploymentTxHash: true,
      deployedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    vaults: rows.map((row) => ({
      ...row,
      deployedAt: row.deployedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}
