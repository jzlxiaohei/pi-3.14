import type {
  ContextCompositionBucket,
  ContextCompositionBucketId,
  ContextCompositionEstimate,
  ContextCompositionInput,
} from "./types.js";

const LABELS: Record<ContextCompositionBucketId, string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
  thinking: "Thinking",
  other: "Other",
};

const ORDER: ContextCompositionBucketId[] = [
  "system",
  "user",
  "assistant",
  "tool",
  "thinking",
  "other",
];

/**
 * Rough context composition via `chars / 4`.
 * Useful for UI share bars; never treat as provider-billed tokens.
 */
export function estimateContextComposition(
  input: ContextCompositionInput,
): ContextCompositionEstimate {
  const totals = emptyTotals();

  add(totals, "system", input.systemPrompt ?? "");

  for (const message of input.messages ?? []) {
    const role = (message.role ?? "").toLowerCase();
    const text = message.text ?? contentToText(message.content);
    const bucket = roleToBucket(role);
    add(totals, bucket, text);
    if (message.thinking) add(totals, "thinking", message.thinking);
  }

  for (const extra of input.extras ?? []) {
    add(totals, "other", extra.text);
  }

  const totalEstimatedTokens = ORDER.reduce((sum, id) => sum + totals[id], 0);
  const buckets: ContextCompositionBucket[] = ORDER.filter((id) => totals[id] > 0).map((id) => ({
    id,
    label: LABELS[id],
    estimatedTokens: totals[id],
    percent: totalEstimatedTokens > 0 ? (totals[id] / totalEstimatedTokens) * 100 : 0,
  }));

  return {
    method: "chars/4",
    totalEstimatedTokens,
    buckets,
  };
}

function emptyTotals(): Record<ContextCompositionBucketId, number> {
  return {
    system: 0,
    user: 0,
    assistant: 0,
    tool: 0,
    thinking: 0,
    other: 0,
  };
}

function add(
  totals: Record<ContextCompositionBucketId, number>,
  id: ContextCompositionBucketId,
  text: string,
): void {
  if (!text) return;
  totals[id] += estimateTokens(text);
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function roleToBucket(role: string): ContextCompositionBucketId {
  if (role === "system" || role === "developer") return "system";
  if (role === "user" || role === "branchsummary" || role === "branch_summary") return "user";
  if (role === "assistant" || role === "model") return "assistant";
  if (role === "tool" || role === "function" || role === "toolresult" || role === "tool_result") {
    return "tool";
  }
  if (role === "thinking" || role === "reasoning") return "thinking";
  if (role === "compaction") return "other";
  return "other";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (content && typeof content === "object") {
      try {
        return JSON.stringify(content);
      } catch {
        return "";
      }
    }
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.thinking === "string") return record.thinking;
      if (record.type === "tool_use" || record.type === "tool_result") {
        try {
          return JSON.stringify(record);
        } catch {
          return "";
        }
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
