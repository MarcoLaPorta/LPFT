import { NextResponse } from "next/server";
import { getOrCreateUserByWallet } from "../../../../../lib/afx-user";
import {
  mergeUserSizingIntoPayload,
  type UserSizingInput,
} from "../../../../../lib/execution-user-sizing";
import { prisma } from "../../../../../lib/prisma";
import { getSigner } from "../../../../../lib/services/signer";
import { buildWeb3SubmissionPayload } from "../../../../../lib/services/web3-keeper";

export const dynamic = "force-dynamic";

type ExecuteBody = {
  routeType?: "PRIMARY" | "SECONDARY";
  payload?: Record<string, unknown>;
  userSizing?: UserSizingInput;
};

/**
 * POST /api/execution/:id/execute?wallet=0x…
 * Conferma esecuzione dal widget (equivalente a tool executeTrade).
 * Body: { routeType, userSizing: { amountIn, tokenIn?, tokenOut?, fee? } }
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: executionLogId } = await ctx.params;
  const wallet = new URL(req.url).searchParams.get("wallet")?.trim().toLowerCase();
  if (!wallet) {
    return NextResponse.json({ error: "wallet query required" }, { status: 400 });
  }

  let body: ExecuteBody = {};
  try {
    body = (await req.json()) as ExecuteBody;
  } catch {
    body = {};
  }

  const routeType = body.routeType ?? "SECONDARY";

  if (!body.userSizing?.amountIn?.trim()) {
    return NextResponse.json(
      { error: "userSizing.amountIn obbligatorio (conferma importo in UI)." },
      { status: 400 },
    );
  }

  try {
    const user = await getOrCreateUserByWallet(wallet);
    const row = await prisma.executionLog.findFirst({
      where: {
        id: executionLogId,
        userId: user.id,
        executionStatus: { in: ["DRAFT", "PENDING_SIGNATURE"] },
      },
    });
    if (!row) {
      return NextResponse.json({ error: "ExecutionLog non trovato o già eseguito" }, { status: 404 });
    }

    const onchainMode = (process.env.AFX_ONCHAIN_CONFIRM_MODE ?? "mock").trim().toLowerCase();
    const chainId = Number(
      process.env.AFX_CHAIN_ID ?? process.env.NEXT_PUBLIC_AFX_CHAIN_ID ?? "31337",
    );

    let mergedPayload: Record<string, unknown> = {
      ...(row.payloadJson && typeof row.payloadJson === "object" && !Array.isArray(row.payloadJson)
        ? (row.payloadJson as Record<string, unknown>)
        : {}),
      routeType,
      ...(body.payload ?? {}),
    };

    const sized = mergeUserSizingIntoPayload(mergedPayload, body.userSizing);
    if ("error" in sized) {
      return NextResponse.json({ error: sized.error }, { status: 400 });
    }
    mergedPayload = sized.payload;

    let transactionHash: string | null = null;

    if (onchainMode === "real") {
      const web3 = await buildWeb3SubmissionPayload({
        userId: user.id,
        chainId,
        payloadJson: mergedPayload,
      });
      if ("error" in web3) {
        return NextResponse.json(
          { error: web3.error, errorCode: web3.errorCode ?? null },
          { status: 422 },
        );
      }
      mergedPayload = { ...mergedPayload, web3: web3.payload };
    } else {
      const signer = getSigner();
      const to = (typeof body.payload?.to === "string"
        ? body.payload.to
        : "0x0000000000000000000000000000000000000001") as `0x${string}`;
      const data = (typeof body.payload?.data === "string" ? body.payload.data : "0x") as `0x${string}`;
      const signed = await signer.signTransaction({
        chainId: typeof body.payload?.chainId === "number" ? body.payload.chainId : chainId,
        to,
        data,
      });
      mergedPayload.kmsKeyId = signed.kmsKeyId;
      transactionHash = signed.hash;
    }

    await prisma.executionLog.update({
      where: { id: row.id },
      data: {
        executionStatus: "SUBMITTED",
        transactionHash,
        actionType: "executeTrade",
        chainId,
        routerAddress:
          onchainMode === "real" && mergedPayload.web3 && typeof mergedPayload.web3 === "object"
            ? String((mergedPayload.web3 as { routerAddress?: string }).routerAddress ?? "").toLowerCase()
            : row.routerAddress,
        payloadJson: mergedPayload as object,
      },
    });

    return NextResponse.json({
      executionLogId: row.id,
      status: "SUBMITTED",
      transactionHash,
      routeType,
      keeperMode: onchainMode,
      sizing: mergedPayload.sizing ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
