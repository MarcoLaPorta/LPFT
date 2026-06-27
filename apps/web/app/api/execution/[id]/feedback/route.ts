import { NextResponse } from "next/server";
import { z } from "zod";
import { getOrCreateUserByWallet } from "../../../../../lib/afx-user";
import { prisma } from "../../../../../lib/prisma";

export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  rating: z.enum(["up", "down"]),
  comment: z.string().trim().max(500).optional(),
});

/**
 * POST /api/execution/:id/feedback?wallet=0x...
 * Body: { rating: "up" | "down", comment?: string }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim().toLowerCase();
  if (!wallet) {
    return NextResponse.json({ error: "wallet query required" }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "rating must be 'up' or 'down'" }, { status: 400 });
  }

  const { rating, comment } = parsed.data;
  const feedbackValue = comment ? `${rating}: ${comment}` : rating;

  const user = await getOrCreateUserByWallet(wallet);
  const row = await prisma.executionLog.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const updated = await prisma.executionLog.update({
    where: { id: row.id },
    data: {
      userFeedback: feedbackValue,
      feedbackAt: new Date(),
    },
    select: {
      id: true,
      userFeedback: true,
      feedbackAt: true,
    },
  });

  return NextResponse.json({
    executionLogId: updated.id,
    rating,
    comment: comment ?? null,
    userFeedback: updated.userFeedback,
    feedbackAt: updated.feedbackAt?.toISOString() ?? null,
  });
}
