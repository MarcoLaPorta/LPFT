import { NextResponse } from "next/server";
import { fetchTier1Validation } from "../../../../lib/lpft-tier1";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Proxy verso LPFT API `/quant/tier1/validate` (Python heavy quant).
 */
export async function POST(req: Request) {
  let body: {
    equity?: number[];
    returns?: number[];
    n_trials?: number;
    mc_paths?: number;
    mc_horizon_days?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if ((!body.equity || body.equity.length === 0) && (!body.returns || body.returns.length === 0)) {
    return NextResponse.json({ error: "Provide equity or returns" }, { status: 400 });
  }

  const result = await fetchTier1Validation({
    equity: body.equity,
    returns: body.returns,
    n_trials: body.n_trials,
    mc_paths: body.mc_paths,
    mc_horizon_days: body.mc_horizon_days,
    timeoutMs: 55_000,
  });

  if (!result) {
    return NextResponse.json(
      {
        error: "LPFT Tier-1 validation unavailable",
        hint: "Avvia l'API Python su :8000 (uvicorn lpft_api.main:app)",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(result);
}
