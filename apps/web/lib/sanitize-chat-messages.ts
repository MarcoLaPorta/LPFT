import { isToolUIPart, type UIMessage } from "ai";

/** Anthropic richiede tool_use.input come oggetto — non stringa/null. */
function coerceToolInput(input: unknown): Record<string, unknown> {
  if (input == null) return {};
  if (typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    const t = input.trim();
    if (!t) return {};
    try {
      const parsed: unknown = JSON.parse(t);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Ripara messaggi UI prima di convertToModelMessages / Anthropic.
 * Evita: "messages.N.content.M.tool_use.input: Input should be an object"
 */
export function sanitizeUIMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .map((message) => {
      if (message.role !== "assistant" || !Array.isArray(message.parts)) {
        return message;
      }

      const parts = message.parts
        .map((part) => {
          if (!isToolUIPart(part)) return part;

          if (part.state === "input-streaming") {
            return null;
          }

          const rawInput =
            "input" in part && part.input !== undefined
              ? part.input
              : "args" in part
                ? (part as { args?: unknown }).args
                : undefined;

          if (rawInput !== undefined) {
            return { ...part, input: coerceToolInput(rawInput) };
          }

          if (part.state === "input-available") {
            return { ...part, input: {} };
          }

          return part;
        })
        .filter((p): p is NonNullable<typeof p> => p != null);

      if (parts.length === 0) {
        return { ...message, parts: [{ type: "text" as const, text: "" }] };
      }

      return { ...message, parts };
    })
    .filter((m) => {
      if (m.role === "user") return true;
      if (m.role === "assistant") {
        return m.parts.some(
          (p) => (p.type === "text" && "text" in p && String(p.text).trim()) || isToolUIPart(p),
        );
      }
      return true;
    });
}
