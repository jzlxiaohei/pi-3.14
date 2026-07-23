import type {
  JsonValue,
  PiModelRef,
  PiStopReason,
  PiThinkingLevel,
} from "@pi-3.14/model";

export type PiJsonObject = { [key: string]: JsonValue };

export const PI_SESSION_ENTRY_TYPES = [
  "message",
  "thinking_level_change",
  "model_change",
  "compaction",
  "branch_summary",
  "custom",
  "custom_message",
  "label",
  "session_info",
] as const;

export type PiKnownSessionEntryType = (typeof PI_SESSION_ENTRY_TYPES)[number];

export interface PiSessionHeaderSnapshot {
  type: "session";
  version: number | null;
  id: string;
  timestamp: string;
  cwd: string;
  /**
   * PI writes a parent session file path, not a stable session ID. Consumers
   * must not treat this as product-level lineage.
   */
  parentSessionPath: string | null;
  raw: PiJsonObject;
  sourceLine: number;
}

export interface PiSessionEntrySnapshot {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  known: boolean;
  raw: PiJsonObject;
  sourceLine: number;
}

export type PiSessionDiagnosticSeverity = "info" | "warning" | "error";

export type PiSessionDiagnosticCode =
  | "incomplete_tail"
  | "malformed_line"
  | "invalid_record"
  | "missing_header"
  | "duplicate_header"
  | "unsupported_version"
  | "duplicate_entry_id"
  | "missing_parent"
  | "cycle"
  | "multiple_roots"
  | "missing_tool_result"
  | "orphan_tool_result"
  | "duplicate_tool_call_id"
  | "invalid_compaction_anchor";

export interface PiSessionDiagnostic {
  code: PiSessionDiagnosticCode;
  severity: PiSessionDiagnosticSeverity;
  message: string;
  sourceLine?: number;
  entryId?: string;
  relatedEntryIds?: string[];
}

export interface PiSessionSnapshot {
  format: "pi-session";
  header: PiSessionHeaderSnapshot | null;
  entries: PiSessionEntrySnapshot[];
  /** Last valid appended entry. PI JSONL has no separately persisted leaf pointer. */
  leafId: string | null;
  rootIds: string[];
  activePathEntryIds: string[];
  diagnostics: PiSessionDiagnostic[];
  trailingFragment: string;
}

export interface PiSessionIndex {
  readonly byId: ReadonlyMap<string, PiSessionEntrySnapshot>;
  readonly childrenById: ReadonlyMap<string | null, readonly PiSessionEntrySnapshot[]>;
  readonly appendIndexById: ReadonlyMap<string, number>;
}

export type PiSessionGraphProjection = "structure" | "execution" | "context";

export type PiSessionGraphNodeKind =
  | "user"
  | "assistant"
  | "toolCall"
  | "toolResult"
  | "compaction"
  | "branchSummary"
  | "customMessage"
  | "metadata"
  | "unknown";

export type PiSessionGraphEdgeKind =
  | "parent"
  | "invokes"
  | "result"
  | "summarizes"
  | "keepsFrom";

export interface PiSessionGraphNode {
  id: string;
  entryId: string | null;
  kind: PiSessionGraphNodeKind;
  label: string;
  timestamp: string | null;
  onActivePath: boolean;
  inEffectiveContext?: boolean;
  data: PiJsonObject;
}

export interface PiSessionGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: PiSessionGraphEdgeKind;
  data?: PiJsonObject;
}

export interface PiSessionGraph {
  projection: PiSessionGraphProjection;
  nodes: PiSessionGraphNode[];
  edges: PiSessionGraphEdge[];
  rootNodeIds: string[];
  diagnostics: PiSessionDiagnostic[];
}

export interface PiEffectiveMessage {
  sourceEntryId: string;
  role: "user" | "assistant" | "toolResult" | "custom" | "branchSummary" | "compaction";
  text: string;
  /** Assistant reasoning blocks from the session message, when present. */
  thinking?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: JsonValue }>;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

export interface PiContextProjection {
  leafId: string | null;
  pathEntryIds: string[];
  effectiveEntryIds: string[];
  excludedPathEntryIds: string[];
  messages: PiEffectiveMessage[];
  model: PiModelRef | null;
  thinkingLevel: PiThinkingLevel | null;
  latestCompaction: {
    entryId: string;
    firstKeptEntryId: string;
    tokensBefore: number | null;
  } | null;
  recoverability: {
    exactFromJsonl: string[];
    unavailableFromJsonl: Array<"systemPrompt" | "tools" | "skills">;
  };
  diagnostics: PiSessionDiagnostic[];
}

export interface PiTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

export interface PiAssistantCallAnalysis {
  entryId: string;
  turnIndex: number;
  model: PiModelRef | null;
  stopReason: PiStopReason | null;
  usage: PiTokenUsage;
}

export interface PiTurnAnalysis {
  index: number;
  userEntryId: string | null;
  assistantEntryIds: string[];
  toolCallIds: string[];
  toolResultEntryIds: string[];
  terminalStopReason: PiStopReason | null;
  usage: PiTokenUsage;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PiToolAnalysis {
  toolCallId: string;
  name: string;
  assistantEntryId: string;
  resultEntryId: string | null;
  isError: boolean | null;
  /** JSONL has no tool-start event; this is assistant message timestamp → result timestamp. */
  durationMsEstimate: number | null;
  timingBasis: "assistantMessageToToolResult" | null;
}

export interface PiSessionAnalysis {
  scope: "activePath";
  leafId: string | null;
  model: PiModelRef | null;
  thinkingLevel: PiThinkingLevel | null;
  entryCount: number;
  activePathEntryCount: number;
  branchPointCount: number;
  maxDepth: number;
  turnCount: number;
  assistantCallCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  compactionCount: number;
  usage: PiTokenUsage;
  turns: PiTurnAnalysis[];
  calls: PiAssistantCallAnalysis[];
  tools: PiToolAnalysis[];
  diagnostics: PiSessionDiagnostic[];
}
