import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** GET /api/health — smoke test DB Prisma (AFX console). */
export async function GET() {
  try {
    const { prisma } = await import("../../../lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    const [
      users,
      executionLogs,
      conversations,
      smartVaults,
      whitelistedRouters,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.executionLog.count(),
      prisma.conversation.count(),
      prisma.smartVault.count(),
      prisma.whitelistedDexRouter.count(),
    ]);
    return NextResponse.json({
      ok: true,
      service: "afx-web",
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
      { ok: false, service: "afx-web", database: "error", error: message },
      { status: 503 },
    );
  }
}
