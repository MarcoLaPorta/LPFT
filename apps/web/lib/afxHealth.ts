import { prisma } from "./prisma";
import type { AfxHealthPayload } from "./afxHealthTypes";

export type { AfxHealthPayload } from "./afxHealthTypes";

/**
 * Lettura server-side dello stato Prisma AFX (stessa origine dell’app Next).
 */
export async function getAfxHealthPayload(): Promise<{
  ok: boolean;
  payload: AfxHealthPayload;
}> {
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
    return {
      ok: true,
      payload: {
        embedded: true,
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
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return {
      ok: false,
      payload: {
        embedded: true,
        ok: false,
        service: "lpft-web",
        database: "error",
        error: message,
      },
    };
  }
}
