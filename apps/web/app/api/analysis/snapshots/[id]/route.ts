import { NextResponse } from "next/server";
import { loadStrategySnapshotForUser, snapshotRowToAnalysis } from "../../../../../lib/afx-snapshot-store";
import { getOrCreateUserByWallet } from "../../../../../lib/afx-user";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet")?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "wallet richiesto" }, { status: 400 });
  }

  try {
    const user = await getOrCreateUserByWallet(wallet);
    const row = await loadStrategySnapshotForUser(id, user.id);
    if (!row) {
      return NextResponse.json({ error: "Report non trovato" }, { status: 404 });
    }
    return NextResponse.json(snapshotRowToAnalysis(row));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore database";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
