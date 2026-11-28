import { ASSISTANT_NAME, BRAND_NAME } from "./brand";

export function latestUserText(messages: unknown[]): string {
  const last = [...messages]
    .reverse()
    .find(
      (message) =>
        message && typeof message === "object" && (message as { role?: unknown }).role === "user",
    ) as { parts?: unknown[]; content?: unknown; text?: unknown } | undefined;
  if (!last) return "";

  const parts = Array.isArray(last.parts) ? last.parts : [];
  if (
    parts.some(
      (part) => part && typeof part === "object" && (part as { type?: string }).type === "file",
    )
  ) {
    return "";
  }
  const fromParts = parts
    .map((part) =>
      part && typeof part === "object" && (part as { type?: string }).type === "text"
        ? ((part as { text?: string }).text ?? "")
        : "",
    )
    .join(" ");
  return (
    fromParts ||
    (typeof last.content === "string" ? last.content : "") ||
    (typeof last.text === "string" ? last.text : "")
  ).trim();
}

export function deterministicAssistantAnswer(messages: unknown[]): string | null {
  const value = latestUserText(messages);
  if (!value || value.length > 120) return null;
  const normalized = value
    .toLowerCase()
    .replace(/[?!.,]+$/g, "")
    .trim();

  if (
    /^(hi|hello|hey|helo|good morning|good afternoon|good evening|yo|salaam|assalamualaikum)(?:\s+(there|bro|brother|psxl))?$/.test(
      normalized,
    )
  ) {
    return `Hi — I’m ${ASSISTANT_NAME}, your financial operations copilot. Ask me about your ledger, upload a broker statement, or connect a source and I’ll help you investigate it.`;
  }

  if (
    /^(what is|what's|what does) (psxl|psxl app|psxl do|psxl used for)$/.test(normalized) ||
    /^(tell me about|explain) psxl$/.test(normalized)
  ) {
    return `${BRAND_NAME} is a source-to-ledger financial operations workspace. It connects broker, bank, wallet, spreadsheet, and document sources; verifies and normalizes records; projects supported transactions into a canonical ledger; and helps you review exceptions with evidence. AI agents do the repetitive analysis and monitoring, while material or uncertain changes remain visible for your approval.`;
  }

  if (/^(how does|how do) psxl work$/.test(normalized) || normalized === "how it works") {
    return `${BRAND_NAME} follows Connect → Verify → Sync → Review → Post → Monitor. Connect a source, verify it, sync the records, inspect any low-confidence or unmatched items, and then monitor freshness and exceptions from one workspace.`;
  }

  if (/^(who are you|what are you|what is your name)$/.test(normalized)) {
    return `I’m ${ASSISTANT_NAME}, the AI assistant built into ${BRAND_NAME}. I can explain the product, inspect your connected financial workspace, and help with ledger and reconciliation tasks. Configured third-party AI providers may power responses, but they do not replace your approval for material changes.`;
  }

  return null;
}
