import { NextResponse } from "next/server";
import { getAfxHealthPayload } from "../../../lib/afxHealth";

export const dynamic = "force-dynamic";

/**
 * Alias di `/api/health` per compatibilità con client che chiamavano ancora afx-health.
 */
export async function GET() {
  const { ok, payload } = await getAfxHealthPayload();
  return NextResponse.json(payload, { status: ok ? 200 : 503 });
}
