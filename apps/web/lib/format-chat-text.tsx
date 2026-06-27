import { Fragment, type ReactNode } from "react";

/** Rimuove emoji comuni dalle risposte assistente. */
const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu;

export function sanitizeChatPlainText(text: string): string {
  return text
    .replace(EMOJI_RE, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "· ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Converte **testo** in grassetto; niente altro markdown. */
export function renderChatFormattedText(text: string): ReactNode {
  const clean = sanitizeChatPlainText(text);
  if (!clean.includes("**")) {
    return clean;
  }

  const parts = clean.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[var(--text-primary)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}
