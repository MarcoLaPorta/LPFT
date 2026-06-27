import type { Tool } from "ai";

/**
 * Anthropic prompt caching (ephemeral) — Tier 1 Phase 4.
 * @see https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
export const ANTHROPIC_EPHEMERAL_CACHE = {
  anthropic: {
    cacheControl: { type: "ephemeral" as const },
  },
} as const;

export type CachedSystemMessage = {
  role: "system";
  content: string;
  providerOptions: typeof ANTHROPIC_EPHEMERAL_CACHE;
};

/** System prompt con breakpoint cache (massimo 4 per richiesta Anthropic). */
export function buildCachedAfxSystem(
  staticContent: string,
  dynamicSuffix?: string,
): CachedSystemMessage {
  const content = dynamicSuffix?.trim()
    ? `${staticContent.trim()}\n\n---\n${dynamicSuffix.trim()}`
    : staticContent.trim();
  return {
    role: "system",
    content,
    providerOptions: ANTHROPIC_EPHEMERAL_CACHE,
  };
}

export function isPromptCacheEnabled(): boolean {
  return process.env.AFX_PROMPT_CACHE !== "false";
}

/** Applica cache al tool (schema tool-definition Anthropic). */
export function withAnthropicToolCache<INPUT, OUTPUT>(
  definition: Tool<INPUT, OUTPUT>,
): Tool<INPUT, OUTPUT> {
  return {
    ...definition,
    providerOptions: {
      ...(definition.providerOptions ?? {}),
      ...ANTHROPIC_EPHEMERAL_CACHE,
    },
  } as Tool<INPUT, OUTPUT>;
}
