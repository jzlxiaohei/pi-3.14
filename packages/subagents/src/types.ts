import type { JsonValue, PiHostEvent, PiTurnResult } from "@pi-3.14/model";

export interface SubagentInput {
  id?: string;
  prompt: string;
  cwd?: string;
  parentId?: string;
  metadata?: Record<string, JsonValue>;
  timeoutMs?: number;
}

export type SubagentStatus = "completed" | "cancelled" | "error";

export interface SubagentResult {
  id: string;
  executor: string;
  status: SubagentStatus;
  text: string;
  startedAt: number;
  finishedAt: number;
  pi?: PiTurnResult;
  errorMessage?: string;
}

export type SubagentEvent =
  | { type: "queued"; at: number; subagentId: string }
  | { type: "started"; at: number; subagentId: string; executor: string }
  | { type: "host_event"; at: number; subagentId: string; event: PiHostEvent }
  | { type: "finished"; at: number; subagentId: string; result: SubagentResult };

export interface SubagentHandle {
  readonly id: string;
  readonly events: AsyncIterable<SubagentEvent>;
  readonly result: Promise<SubagentResult>;
  abort(): Promise<void>;
}

export interface SubagentExecution {
  readonly events: AsyncIterable<PiHostEvent>;
  readonly result: Promise<PiTurnResult>;
  abort(): Promise<void>;
  dispose(): Promise<void>;
}

export interface SubagentExecutor {
  readonly kind: string;
  start(input: SubagentInput): Promise<SubagentExecution>;
}
