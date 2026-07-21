import {
  type JsonValue,
  type PiHostEvent,
  type PiStopReason,
  toJsonValue,
} from "@pi-3.14/model";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

export function messageText(message: unknown): string {
  const content = record(message).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const item = record(part);
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .join("");
}

export function messageStopReason(message: unknown): PiStopReason | undefined {
  const reason = record(message).stopReason;
  return reason === "stop" ||
    reason === "length" ||
    reason === "toolUse" ||
    reason === "error" ||
    reason === "aborted"
    ? reason
    : undefined;
}

export function projectPiEvent(event: unknown, at = Date.now()): PiHostEvent | undefined {
  const source = record(event);
  switch (source.type) {
    case "agent_start":
      return { type: "agent_start", at };
    case "message_update": {
      const update = record(source.assistantMessageEvent);
      return update.type === "text_delta" && typeof update.delta === "string"
        ? { type: "text_delta", at, text: update.delta }
        : undefined;
    }
    case "tool_execution_start":
      return {
        type: "tool_start",
        at,
        toolCallId: String(source.toolCallId ?? ""),
        toolName: String(source.toolName ?? ""),
        args: toJsonValue(source.args),
      };
    case "tool_execution_update":
      return {
        type: "tool_update",
        at,
        toolCallId: String(source.toolCallId ?? ""),
        toolName: String(source.toolName ?? ""),
        partialResult: toJsonValue(source.partialResult),
      };
    case "tool_execution_end":
      return {
        type: "tool_end",
        at,
        toolCallId: String(source.toolCallId ?? ""),
        toolName: String(source.toolName ?? ""),
        result: toJsonValue(source.result),
        isError: source.isError === true,
      };
    case "message_end": {
      const message = source.message;
      const role = record(message).role;
      const stopReason = messageStopReason(message);
      return {
        type: "message_end",
        at,
        role: typeof role === "string" ? role : "unknown",
        text: messageText(message),
        ...(stopReason ? { stopReason } : {}),
      };
    }
    case "queue_update":
      return {
        type: "queue_update",
        at,
        steering: stringArray(source.steering),
        followUp: stringArray(source.followUp),
      };
    case "compaction_start":
      return {
        type: "compaction",
        at,
        phase: "start",
        reason: compactionReason(source.reason),
      };
    case "compaction_end":
      return {
        type: "compaction",
        at,
        phase: "end",
        reason: compactionReason(source.reason),
        aborted: source.aborted === true,
        willRetry: source.willRetry === true,
        ...(typeof source.errorMessage === "string" ? { errorMessage: source.errorMessage } : {}),
      };
    case "auto_retry_start":
      return {
        type: "retry",
        at,
        phase: "start",
        attempt: numberValue(source.attempt),
        ...(typeof source.errorMessage === "string" ? { errorMessage: source.errorMessage } : {}),
      };
    case "auto_retry_end":
      return {
        type: "retry",
        at,
        phase: "end",
        attempt: numberValue(source.attempt),
        success: source.success === true,
        ...(typeof source.finalError === "string" ? { errorMessage: source.finalError } : {}),
      };
    default:
      return undefined;
  }
}

export function jsonRecord(value: unknown): JsonValue {
  return toJsonValue(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function compactionReason(value: unknown): "manual" | "threshold" | "overflow" {
  return value === "threshold" || value === "overflow" ? value : "manual";
}
