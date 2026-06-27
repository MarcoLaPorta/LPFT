import { NextResponse } from "next/server";
import { markStrategySnapshotSaved } from "../../../../../lib/afx-snapshot-store";
import { getOrCreateUserByWallet } from "../../../../../lib/afx-user";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "wallet richiesto" }, { status: 400 });
  }

  let body: { title?: string } = {};
  try {
    body = (await req.json()) as { title?: string };
  } catch {
    /* title opzionale */
  }

  try {
    const user = await getOrCreateUserByWallet(wallet);
    const ok = await markStrategySnapshotSaved(id, user.id, body.title);
    if (!ok) {
      return NextResponse.json({ error: "Strategia non trovata" }, { status: 404 });
    }
    return NextResponse.json({
      snapshotId: id,
      savedAt: new Date().toISOString(),
      reportUrl: `/analysis/${id}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore database";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
