/**
 * Transport-safe PI projections. This package intentionally has no dependency
 * on Node.js or the PI SDK so browser and non-Node clients can consume it.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PiStopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
export type PiTerminalStopReason = Exclude<PiStopReason, "toolUse">;
export type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface PiModelRef {
  provider: string;
  id: string;
}

export interface PiHostState {
  sessionId: string;
  sessionPath: string | null;
  isStreaming: boolean;
  isCompacting: boolean;
  model: PiModelRef | null;
  thinkingLevel: PiThinkingLevel;
}

export type PiHostEvent =
  | { type: "agent_start"; at: number }
  | { type: "text_delta"; at: number; text: string }
  | {
      type: "tool_start";
      at: number;
      toolCallId: string;
      toolName: string;
      args: JsonValue;
    }
  | {
      type: "tool_update";
      at: number;
      toolCallId: string;
      toolName: string;
      partialResult: JsonValue;
    }
  | {
      type: "tool_end";
      at: number;
      toolCallId: string;
      toolName: string;
      result: JsonValue;
      isError: boolean;
    }
  | {
      type: "message_end";
      at: number;
      role: string;
      text: string;
      stopReason?: PiStopReason;
    }
  | {
      type: "queue_update";
      at: number;
      steering: string[];
      followUp: string[];
    }
  | {
      type: "compaction";
      at: number;
      phase: "start" | "end";
      reason: "manual" | "threshold" | "overflow";
      aborted?: boolean;
      willRetry?: boolean;
      errorMessage?: string;
    }
  | {
      type: "retry";
      at: number;
      phase: "start" | "end";
      attempt: number;
      success?: boolean;
      errorMessage?: string;
    };

export interface PiTurnResult {
  stopReason: PiTerminalStopReason;
  text: string;
  sessionId: string;
  sessionPath: string | null;
  leafEntryId: string | null;
  errorMessage?: string;
}

export function isTerminalStopReason(reason: PiStopReason): reason is PiTerminalStopReason {
  return reason !== "toolUse";
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : (JSON.parse(serialized) as JsonValue);
  } catch {
    return String(value);
  }
}
