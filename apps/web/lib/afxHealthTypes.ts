/**
 * Solo tipi — nessun import Prisma (sicuro per `import type` dai Client Components).
 */
export type AfxHealthPayload = {
  proxy?: boolean;
  embedded?: boolean;
  ok?: boolean;
  service?: string;
  database?: string;
  counts?: {
    users: number;
    executionLogs: number;
    conversations: number;
    smartVaults?: number;
    whitelistedRouters?: number;
  };
  error?: string;
};
