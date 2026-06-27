import { NextResponse } from "next/server";
import { fetchHistoricalOhlcv } from "../../../../services/market_data";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/history?symbol=AAPL&from=2020-01-01&to=2024-01-01&interval=1d
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol")?.trim().toUpperCase();
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const interval = searchParams.get("interval") as "1d" | "1wk" | "1mo" | null;

  if (!symbol || !from || !to) {
    return NextResponse.json(
      { error: "Missing query: symbol, from, to (ISO dates YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  if (!/^(\^[A-Z0-9.\-]{1,24}|[A-Z0-9][A-Z0-9.\-]{0,24})$/.test(symbol)) {
    return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const period1 = new Date(from);
  const period2 = new Date(to);
  if (Number.isNaN(+period1) || Number.isNaN(+period2)) {
    return NextResponse.json({ error: "Invalid from/to date" }, { status: 400 });
  }

  try {
    const bars = await fetchHistoricalOhlcv(symbol, {
      period1,
      period2,
      interval: interval ?? "1d",
    });
    return NextResponse.json({ symbol, count: bars.length, bars });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
