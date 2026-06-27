import { NextResponse } from "next/server";
import { persistStrategySnapshot, type PersistSnapshotInput } from "../../../../lib/afx-snapshot-store";
import { getOrCreateUserByWallet } from "../../../../lib/afx-user";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get("wallet")?.trim();
  if (!wallet) {
    return NextResponse.json({ error: "wallet richiesto" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const symbol = String(b.symbol ?? "").toUpperCase();
  if (!symbol) {
    return NextResponse.json({ error: "symbol obbligatorio" }, { status: 400 });
  }

  const source = String(b.source ?? "runStrategyBacktest") as PersistSnapshotInput["source"];
  const saved = b.saved === true;
  const title = b.title ? String(b.title).slice(0, 256) : undefined;

  try {
    const user = await getOrCreateUserByWallet(wallet);
    const id = await persistStrategySnapshot({
      userId: user.id,
      source,
      symbol,
      benchmark: b.benchmark ? String(b.benchmark) : undefined,
      intentClass: b.intentClass ? String(b.intentClass) : undefined,
      intentSummary: b.intentSummary ? String(b.intentSummary) : undefined,
      compiledStrategy: b.compiledStrategy,
      engineSpec: b.engineSpec,
      metrics: b.metrics as PersistSnapshotInput["metrics"],
      benchmarkMetrics: b.benchmarkMetrics as PersistSnapshotInput["benchmarkMetrics"],
      series: b.series as PersistSnapshotInput["series"],
      projections: b.projections as PersistSnapshotInput["projections"],
      trades: b.trades as PersistSnapshotInput["trades"],
      marketContext: b.marketContext as PersistSnapshotInput["marketContext"],
      marketRoutingMode: b.marketRoutingMode ? String(b.marketRoutingMode) : undefined,
      riskCapsApplied: b.riskCapsApplied as PersistSnapshotInput["riskCapsApplied"],
      executionLogId: b.executionLogId ? String(b.executionLogId) : undefined,
      saved,
      title,
    });

    if (!id) {
      return NextResponse.json(
        {
          error:
            "Impossibile salvare il report. Esegui: cd apps/web && npx prisma migrate deploy",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ snapshotId: id, reportUrl: `/analysis/${id}` });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Errore database";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
