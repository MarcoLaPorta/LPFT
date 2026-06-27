import { NextResponse } from "next/server";
import { fetchEquityQuotes } from "../../../../services/market_data";

export const dynamic = "force-dynamic";

/**
 * GET /api/market/quotes?symbols=SPY,AAPL,^GSPC
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("symbols")?.trim();
  if (!raw) {
    return NextResponse.json({ error: "Missing query: symbols (comma-separated)" }, { status: 400 });
  }
  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({ error: "No symbols" }, { status: 400 });
  }
  if (symbols.length > 24) {
    return NextResponse.json({ error: "Too many symbols (max 24)" }, { status: 400 });
  }
  const symOk = /^(\^[A-Z0-9.\-]{1,24}|[A-Z0-9][A-Z0-9.\-]{0,24})$/;
  if (symbols.some((s) => !symOk.test(s))) {
    return NextResponse.json({ error: "Invalid symbol in list" }, { status: 400 });
  }

  try {
    const quotes = await fetchEquityQuotes(symbols);
    return NextResponse.json({ count: quotes.length, quotes });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
