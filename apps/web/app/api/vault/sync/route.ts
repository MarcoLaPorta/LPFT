import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateUserByWallet } from "../../../../lib/afx-user";
import { prisma } from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  deploymentTxHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  managerAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
});

/**
 * POST /api/vault/sync
 * Registra in Prisma un vault creato on-chain (dopo createVault dalla Factory).
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const wallet = parsed.data.wallet.toLowerCase();
  const vaultAddress = parsed.data.vaultAddress.toLowerCase();
  const user = await getOrCreateUserByWallet(wallet);

  const managerAddress =
    parsed.data.managerAddress?.toLowerCase() ??
    process.env.AFX_MANAGER_ADDRESS?.toLowerCase() ??
    "0x0000000000000000000000000000000000000000";

  const row = await prisma.smartVault.upsert({
    where: { vaultAddress },
    create: {
      userId: user.id,
      chainId: parsed.data.chainId,
      vaultAddress,
      managerAddress,
      status: "ACTIVE",
      deployedAt: new Date(),
      deploymentTxHash: parsed.data.deploymentTxHash ?? null,
    },
    update: {
      status: "ACTIVE",
      deployedAt: new Date(),
      deploymentTxHash: parsed.data.deploymentTxHash ?? undefined,
      managerAddress,
    },
  });

  const factoryAddr = process.env.AFX_VAULT_FACTORY_ADDRESS?.trim();
  if (factoryAddr) {
    await prisma.vaultFactoryConfig.upsert({
      where: { chainId: parsed.data.chainId },
      create: {
        chainId: parsed.data.chainId,
        factoryAddress: factoryAddr.toLowerCase(),
      },
      update: {
        factoryAddress: factoryAddr.toLowerCase(),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    vault: {
      id: row.id,
      vaultAddress: row.vaultAddress,
      chainId: row.chainId,
      status: row.status,
    },
  });
}
