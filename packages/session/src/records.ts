import type { JsonValue, PiModelRef, PiStopReason, PiThinkingLevel } from "@pi-3.14/model";
import type {
  PiJsonObject,
  PiSessionEntrySnapshot,
  PiTokenUsage,
} from "./types.js";

export function jsonObject(value: JsonValue | undefined): PiJsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;
}

export function messageRecord(entry: PiSessionEntrySnapshot): PiJsonObject | undefined {
  return entry.type === "message" ? jsonObject(entry.raw.message) : undefined;
}

export function messageRole(entry: PiSessionEntrySnapshot): string | undefined {
  const role = messageRecord(entry)?.role;
  return typeof role === "string" ? role : undefined;
}

export function textContent(value: JsonValue | undefined): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      const item = jsonObject(block);
      return item?.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function thinkingContent(value: JsonValue | undefined): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      const item = jsonObject(block);
      return item?.type === "thinking" && typeof item.thinking === "string" ? item.thinking : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function toolCalls(entry: PiSessionEntrySnapshot): Array<{
  id: string;
  name: string;
  arguments: JsonValue;
}> {
  const content = messageRecord(entry)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const item = jsonObject(block);
    if (
      item?.type !== "toolCall" ||
      typeof item.id !== "string" ||
      typeof item.name !== "string"
    ) {
      return [];
    }
    return [{ id: item.id, name: item.name, arguments: item.arguments ?? null }];
  });
}

export function stopReason(entry: PiSessionEntrySnapshot): PiStopReason | null {
  const reason = messageRecord(entry)?.stopReason;
  return reason === "stop" ||
    reason === "length" ||
    reason === "toolUse" ||
    reason === "error" ||
    reason === "aborted"
    ? reason
    : null;
}

export function modelRef(entry: PiSessionEntrySnapshot): PiModelRef | null {
  if (entry.type === "model_change") {
    const provider = entry.raw.provider;
    const id = entry.raw.modelId;
    return typeof provider === "string" && typeof id === "string" ? { provider, id } : null;
  }
  const message = messageRecord(entry);
  const provider = message?.provider;
  const id = message?.model;
  return typeof provider === "string" && typeof id === "string" ? { provider, id } : null;
}

export function thinkingLevel(entry: PiSessionEntrySnapshot): PiThinkingLevel | null {
  if (entry.type !== "thinking_level_change") return null;
  const level = entry.raw.thinkingLevel;
  return level === "off" ||
    level === "minimal" ||
    level === "low" ||
    level === "medium" ||
    level === "high" ||
    level === "xhigh" ||
    level === "max"
    ? level
    : null;
}

export function emptyUsage(): PiTokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
}

export function addUsage(left: PiTokenUsage, right: PiTokenUsage): PiTokenUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    totalTokens: left.totalTokens + right.totalTokens,
    cost: left.cost + right.cost,
  };
}

export function entryUsage(entry: PiSessionEntrySnapshot): PiTokenUsage {
  const usage = jsonObject(messageRecord(entry)?.usage);
  const cost = jsonObject(usage?.cost);
  return {
    input: numberValue(usage?.input),
    output: numberValue(usage?.output),
    cacheRead: numberValue(usage?.cacheRead),
    cacheWrite: numberValue(usage?.cacheWrite),
    totalTokens: numberValue(usage?.totalTokens),
    cost: numberValue(cost?.total),
  };
}

export function entryLabel(entry: PiSessionEntrySnapshot): string {
  const role = messageRole(entry);
  if (role === "user") return truncate(textContent(messageRecord(entry)?.content)) || "User";
  if (role === "assistant") {
    return truncate(textContent(messageRecord(entry)?.content)) || `Assistant · ${stopReason(entry) ?? "unknown"}`;
  }
  if (role === "toolResult") {
    const name = messageRecord(entry)?.toolName;
    return typeof name === "string" ? `Tool result · ${name}` : "Tool result";
  }
  if (entry.type === "compaction") return "Compaction";
  if (entry.type === "branch_summary") return "Branch summary";
  if (entry.type === "custom_message") return `Custom message · ${String(entry.raw.customType ?? "")}`;
  return entry.type;
}

export function timestampMs(timestamp: string): number | null {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : null;
}

export function entryTimestampMs(entry: PiSessionEntrySnapshot): number | null {
  const messageTimestamp = messageRecord(entry)?.timestamp;
  return typeof messageTimestamp === "number" && Number.isFinite(messageTimestamp)
    ? messageTimestamp
    : timestampMs(entry.timestamp);
}

function numberValue(value: JsonValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function truncate(text: string, max = 80): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}
