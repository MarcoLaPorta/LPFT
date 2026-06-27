import { NextResponse } from "next/server";
import { fetchPairedHistory } from "../../../../services/market_data";
import { runStrategyBacktest, type StrategySpec } from "../../../../services/quant/backtest";

export const dynamic = "force-dynamic";

type Body = {
  symbol?: string;
  benchmarkSymbol?: string;
  from?: string;
  to?: string;
  strategy?: StrategySpec;
  projectionHorizonDays?: number;
  projectionMcPaths?: number;
  projectionLookback?: number;
};

function parseStrategy(body: Body): StrategySpec {
  const s = body.strategy;
  if (!s || s.kind === "buy_and_hold") {
    return { kind: "buy_and_hold" };
  }
  if (s.kind === "drawdown_to_stable") {
    const maxDrawdownFrac = s.maxDrawdownFrac ?? 0.12;
    const reentrySmaDays = s.reentrySmaDays ?? 50;
    return { kind: "drawdown_to_stable", maxDrawdownFrac, reentrySmaDays };
  }
  return { kind: "buy_and_hold" };
}

/**
 * POST /api/quant/backtest
 * Body JSON: { symbol, benchmarkSymbol?, from, to, strategy?, projectionHorizonDays?, ... }
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const symbol = body.symbol?.trim().toUpperCase();
  const benchmarkSymbol = (body.benchmarkSymbol ?? "^GSPC").trim().toUpperCase();
  const from = body.from;
  const to = body.to;

  if (!symbol || !from || !to) {
    return NextResponse.json(
      { error: "Body must include symbol, from, to (ISO dates)" },
      { status: 400 },
    );
  }

  const period1 = new Date(from);
  const period2 = new Date(to);
  if (Number.isNaN(+period1) || Number.isNaN(+period2)) {
    return NextResponse.json({ error: "Invalid from/to" }, { status: 400 });
  }

  const strategy = parseStrategy(body);

  try {
    const { aligned, asset, benchmark } = await fetchPairedHistory(symbol, benchmarkSymbol, {
      period1,
      period2,
    });

    const result = runStrategyBacktest(aligned, strategy, {
      projectionHorizonDays: body.projectionHorizonDays,
      projectionMcPaths: body.projectionMcPaths,
      projectionLookback: body.projectionLookback,
    });

    return NextResponse.json({
      symbol,
      benchmarkSymbol,
      strategy,
      barCounts: { asset: asset.length, benchmark: benchmark.length, aligned: aligned.length },
      ...result,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
