import { NextResponse } from "next/server";
import { getOrCreateUserByWallet } from "../../../../lib/afx-user";

export const dynamic = "force-dynamic";

const REQUIRED_ENV = [
  "AFX_CHAIN_ID",
  "AFX_VAULT_FACTORY_ADDRESS",
  "AFX_SIGNER_MODE",
  "AFX_KMS_PROVIDER",
  "AFX_KMS_KEY_REF",
  "AFX_KMS_REGION",
] as const;

/**
 * POST /api/vault/deploy?wallet=0x...
 * Stub deploy: ritorna 501 finché la configurazione chain non è attiva.
 */
export async function POST(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim().toLowerCase();
  if (!wallet) {
    return NextResponse.json({ error: "wallet query required" }, { status: 400 });
  }

  // Enforce same wallet→user resolution pattern used by execution routes.
  await getOrCreateUserByWallet(wallet);

  return NextResponse.json(
    {
      error: "Vault deploy not implemented. Configure chain + signer first.",
      requiredEnv: REQUIRED_ENV,
    },
    { status: 501 },
  );
}
