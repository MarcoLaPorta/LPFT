import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";

export const dynamic = "force-dynamic";

/** Health DB Prisma (layer exchange AFX), stessa app Next. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const [users, executionLogs, conversations, smartVaults, whitelistedRouters] =
      await Promise.all([
        prisma.user.count(),
        prisma.executionLog.count(),
        prisma.conversation.count(),
        prisma.smartVault.count(),
        prisma.whitelistedDexRouter.count(),
      ]);
    return NextResponse.json({
      ok: true,
      service: "lpft-web",
      database: "connected",
      counts: {
        users,
        executionLogs,
        conversations,
        smartVaults,
        whitelistedRouters,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json(
      { ok: false, service: "lpft-web", database: "error", error: message },
      { status: 503 },
    );
  }
}
