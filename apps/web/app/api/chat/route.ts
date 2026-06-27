import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { NextResponse } from "next/server";
import { createAfxChatTools } from "../../../lib/afx-chat-tools";
import {
  buildCachedAfxSystem,
  isPromptCacheEnabled,
} from "../../../lib/afx-anthropic-cache";
import {
  AFX_FIDUCIARY_STATIC_SYSTEM,
  AFX_PROMPT_VERSION,
} from "../../../lib/afx-fiduciary-prompt";
import { getOrCreateUserByWallet } from "../../../lib/afx-user";
import { prisma } from "../../../lib/prisma";
import { sanitizeUIMessages } from "../../../lib/sanitize-chat-messages";

export const maxDuration = 120;

export const dynamic = "force-dynamic";

/** ID client legacy condiviso da tutti i browser — non riusare come PK DB. */
const LEGACY_SHARED_CHAT_IDS = new Set(["afx-fiduciary-chat-v1"]);

function isPrismaUniqueConstraint(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}

async function resolveConversationId(args: {
  incomingConversationId?: string;
  userId: string;
  title: string | null;
}): Promise<string> {
  const incoming = args.incomingConversationId?.trim();
  const mintId = () => crypto.randomUUID().replace(/-/g, "");

  if (!incoming || LEGACY_SHARED_CHAT_IDS.has(incoming)) {
    const created = await prisma.conversation.create({
      data: { id: mintId(), userId: args.userId, title: args.title },
      select: { id: true },
    });
    return created.id;
  }

  const byId = await prisma.conversation.findUnique({
    where: { id: incoming },
    select: { id: true, userId: true },
  });
  if (byId) {
    if (byId.userId !== args.userId) {
      const created = await prisma.conversation.create({
        data: { id: mintId(), userId: args.userId, title: args.title },
        select: { id: true },
      });
      return created.id;
    }
    return byId.id;
  }

  try {
    const created = await prisma.conversation.create({
      data: { id: incoming, userId: args.userId, title: args.title },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    if (!isPrismaUniqueConstraint(e)) throw e;
    const raced = await prisma.conversation.findUnique({
      where: { id: incoming },
      select: { id: true, userId: true },
    });
    if (raced?.userId === args.userId) return raced.id;
    const created = await prisma.conversation.create({
      data: { id: mintId(), userId: args.userId, title: args.title },
      select: { id: true },
    });
    return created.id;
  }
}

function extractTextFromMessage(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function buildAssistantFallbackSummary(parts: UIMessage["parts"]): string {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (
      part.type.startsWith("tool-") &&
      "state" in part &&
      part.state === "output-available"
    ) {
      const toolName = part.type.replace(/^tool-/, "");
      return `Tool ${toolName} completato.`;
    }
  }
  return "Risposta assistant senza testo.";
}

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
    conversationId?: string;
  };

  const messages = sanitizeUIMessages(b.messages ?? []);
  const wallet =
    b.walletAddress?.trim() ||
    process.env.AFX_CHAT_DEFAULT_WALLET ||
    "0x0000000000000000000000000000000000000afb";

  let user;
  try {
    user = await getOrCreateUserByWallet(wallet);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Database non disponibile";
    return NextResponse.json(
      { error: `AFX DB: ${message}. Imposta DATABASE_URL in apps/web/.env.local` },
      { status: 503 },
    );
  }

  const incomingConversationId = b.conversationId?.trim();
  const titleFromUser =
    extractTextFromMessage(messages.find((m) => m.role === "user")).slice(0, 120) || null;

  let conversationId: string;
  try {
    conversationId = await resolveConversationId({
      incomingConversationId,
      userId: user.id,
      title: titleFromUser,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Errore persistenza conversazione";
    return NextResponse.json({ error: `AFX DB: ${message}` }, { status: 503 });
  }

  const modelId =
    process.env.AFX_ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const tools = createAfxChatTools({
    userId: user.id,
    conversationId,
    modelId,
    promptVersion: AFX_PROMPT_VERSION,
  });

  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(messages, {
      tools,
      ignoreIncompleteToolCalls: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Messaggi chat non validi";
    return NextResponse.json(
      {
        error: `${message}. Prova a ricaricare la pagina (nuova chat) e ripeti la richiesta.`,
      },
      { status: 400 },
    );
  }

  const latestUserText = extractTextFromMessage([...messages].reverse().find((m) => m.role === "user"));
  if (latestUserText) {
    try {
      await prisma.message.create({
        data: {
          conversationId,
          role: "user",
          content: latestUserText,
        },
      });
    } catch {
      // Non bloccare la chat in caso di errore persistenza messaggio.
    }
  }

  const dynamicSystemSuffix = `prompt_version=${AFX_PROMPT_VERSION}; model=${modelId}`;
  const system = isPromptCacheEnabled()
    ? buildCachedAfxSystem(AFX_FIDUCIARY_STATIC_SYSTEM, dynamicSystemSuffix)
    : `${AFX_FIDUCIARY_STATIC_SYSTEM}\n\n---\n${dynamicSystemSuffix}`;

  const result = streamText({
    model: anthropic(modelId),
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(16),
    onFinish: async ({ text, response, usage, providerMetadata }) => {
      const responseMessages = response?.messages ?? [];
      const lastMsg = responseMessages[responseMessages.length - 1];
      const lastParts =
        lastMsg && "parts" in lastMsg && Array.isArray(lastMsg.parts)
          ? (lastMsg.parts as UIMessage["parts"])
          : [];
      const assistantText = text.trim() || buildAssistantFallbackSummary(lastParts);
      try {
        await prisma.message.create({
          data: {
            conversationId,
            role: "assistant",
            content: assistantText,
          },
        });
      } catch {
        // Non bloccare lo streaming se il salvataggio assistant fallisce.
      }

      if (process.env.AFX_LOG_PROMPT_CACHE === "true") {
        const anthropicMeta = providerMetadata?.anthropic as
          | { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
          | undefined;
        console.info("[AFX] chat usage", {
          inputTokens: usage?.inputTokens,
          outputTokens: usage?.outputTokens,
          cacheRead: anthropicMeta?.cacheReadInputTokens,
          cacheWrite: anthropicMeta?.cacheCreationInputTokens,
        });
      }
    },
  });

  return result.toUIMessageStreamResponse({
    headers: {
      "x-afx-conversation-id": conversationId,
      "x-afx-prompt-version": AFX_PROMPT_VERSION,
      "x-afx-prompt-cache": isPromptCacheEnabled() ? "on" : "off",
    },
  });
}
