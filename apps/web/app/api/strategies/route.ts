import { NextResponse } from "next/server";
import { listSavedStrategySnapshots } from "../../../lib/afx-snapshot-store";
import { getOrCreateUserByWallet } from "../../../lib/afx-user";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "wallet richiesto" }, { status: 400 });
  }

  try {
    const user = await getOrCreateUserByWallet(wallet);
    const strategies = await listSavedStrategySnapshots(user.id);
    return NextResponse.json({
      strategies: strategies.map((s) => ({
        id: s.id,
        title: s.title,
        symbol: s.symbol,
        benchmark: s.benchmark,
        source: s.source,
        intentSummary: s.intentSummary,
        intentClass: s.intentClass,
        metrics: s.metrics,
        savedAt: s.savedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
        reportUrl: `/analysis/${s.id}`,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore database";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
