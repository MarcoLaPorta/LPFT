import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { createAfxChatTools } from "../../../lib/afx-chat-tools";
import { getOrCreateUserByWallet } from "../../../lib/afx-user";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

const AFX_SYSTEM = `Sei l'agente quantitativo di Agentic Finance Exchange (AFX), terminale istituzionale RWA + DeFi.
Regole:
- Non inventare prezzi: per dati e simulazioni usa sempre i tool analyzeMarketData e runStrategyBacktest.
- Prima di proposeExecution devi aver mostrato all'utente metriche e rischi sintetici (Sharpe, max drawdown, orizzonte).
- proposeExecution crea solo un record DRAFT in database; l'esecuzione on-chain simulata avviene con executeSwap se l'utente conferma esplicitamente.
- Risposte concise, tono professionale, niente hype retail.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Configura ANTHROPIC_API_KEY in apps/web/.env.local" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const b = body as {
    messages?: UIMessage[];
    walletAddress?: string;
  };

  const messages = b.messages ?? [];
  const wallet =
    b.walletAddress?.trim() ||
    process.env.AFX_CHAT_DEFAULT_WALLET ||
    "0x0000000000000000000000000000000000000afb";

  const user = await getOrCreateUserByWallet(wallet);
  const tools = createAfxChatTools({ userId: user.id });

  const modelId =
    process.env.AFX_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";

  const modelMessages = await convertToModelMessages(messages, {
    tools,
    ignoreIncompleteToolCalls: true,
  });

  const result = streamText({
    model: anthropic(modelId),
    system: AFX_SYSTEM,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(14),
  });

  return result.toUIMessageStreamResponse();
}
