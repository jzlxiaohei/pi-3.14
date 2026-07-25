import type {
  PiHostEvent,
  PiHostState,
  PiLiveInspectSnapshot,
  PiModelOption,
  PiNavigateTreeResult,
  PiPreparedBranchSummary,
  PiThinkingLevel,
  PiTurnResult,
} from "@pi-3.14/model";

export type { PiLiveInspectSnapshot, PiNavigateTreeResult, PiPreparedBranchSummary };

export interface PiPromptInput {
  text: string;
}

export interface PiTurnHandle {
  readonly events: AsyncIterable<PiHostEvent>;
  readonly result: Promise<PiTurnResult>;
}

export interface PiHostCapabilities {
  readonly execution: "embedded" | "rpc";
  readonly processIsolation: boolean;
  readonly customTools: boolean;
  readonly rawSessionAccess: boolean;
  /**
   * PI 0.80.3 does not expose agent_settled over every host. False means the
   * host derives settlement from willRetry plus current state.
   */
  readonly settledEvent: boolean;
}

export interface PiSessionReplacementResult {
  cancelled: boolean;
}

export interface PiForkResult extends PiSessionReplacementResult {
  selectedText?: string;
}

export interface PiHost {
  readonly capabilities: PiHostCapabilities;
  prompt(input: PiPromptInput | string): PiTurnHandle;
  /**
   * Continue generation from the current leaf without appending a new user message.
   * Last transcript message must be a user (or tool-result) — used to retry an
   * unanswered latest user turn.
   */
  continueTurn(): PiTurnHandle;
  steer(input: PiPromptInput | string): Promise<void>;
  followUp(input: PiPromptInput | string): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<PiHostState>;
  /** Models with configured auth (may be empty while providers refresh). */
  listModels(): Promise<PiModelOption[]>;
  setModel(provider: string, modelId: string): Promise<PiHostState>;
  listThinkingLevels(): Promise<PiThinkingLevel[]>;
  setThinkingLevel(level: PiThinkingLevel): Promise<PiHostState>;
  newSession(options?: { parentSession?: string }): Promise<PiSessionReplacementResult>;
  switchSession(sessionPath: string): Promise<PiSessionReplacementResult>;
  fork(entryId: string): Promise<PiForkResult>;
  /**
   * Live system prompt, tools, context usage, and billed session stats.
   * `detail: "summary"` skips transcript convertToLlm (HUD / meters).
   * `detail: "full"` (default) includes sessionMessages + assembled for Context.
   */
  inspectLive(options?: { detail?: "summary" | "full" }): Promise<PiLiveInspectSnapshot>;
  /**
   * Move the leaf within the same session file (Cursor-style revert / branch).
   * Unlike `fork`, does not create a new session file.
   */
  navigateTree(
    entryId: string,
    options?: { summarize?: boolean; label?: string },
  ): Promise<PiNavigateTreeResult>;
  /** Generate a leave-path summary for the current leaf without navigating. */
  prepareBranchSummary(): Promise<PiPreparedBranchSummary>;
  getPreparedBranchSummary(): Promise<PiPreparedBranchSummary | null>;
  clearPreparedBranchSummary(): Promise<void>;
  dispose(): Promise<void>;
}

export function promptText(input: PiPromptInput | string): string {
  return typeof input === "string" ? input : input.text;
}
