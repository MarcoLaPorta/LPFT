import { NextResponse } from "next/server";

export async function GET() {
  return new NextResponse("OK – il server risponde", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
