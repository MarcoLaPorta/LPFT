import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_EPHEMERAL_CACHE,
  buildCachedAfxSystem,
  isPromptCacheEnabled,
} from "./afx-anthropic-cache";
import { AFX_FIDUCIARY_STATIC_SYSTEM, AFX_PROMPT_VERSION } from "./afx-fiduciary-prompt";
import { AFX_STRATEGY_SCHEMA_GUIDE } from "./afx-strategy-schema-guide";

describe("afx-anthropic-cache", () => {
  it("buildCachedAfxSystem imposta cacheControl ephemeral", () => {
    const msg = buildCachedAfxSystem("static body", "v=1");
    expect(msg.role).toBe("system");
    expect(msg.content).toContain("static body");
    expect(msg.content).toContain("v=1");
    expect(msg.providerOptions).toEqual(ANTHROPIC_EPHEMERAL_CACHE);
  });

  it("prompt statico include guida schema Tier 1", () => {
    expect(AFX_FIDUCIARY_STATIC_SYSTEM).toContain("fractionalKelly");
    expect(AFX_FIDUCIARY_STATIC_SYSTEM).toContain(AFX_STRATEGY_SCHEMA_GUIDE);
    expect(AFX_PROMPT_VERSION).toContain("v3");
  });

  it("isPromptCacheEnabled rispetta AFX_PROMPT_CACHE=false", () => {
    const prev = process.env.AFX_PROMPT_CACHE;
    process.env.AFX_PROMPT_CACHE = "false";
    expect(isPromptCacheEnabled()).toBe(false);
    process.env.AFX_PROMPT_CACHE = prev;
  });
});
