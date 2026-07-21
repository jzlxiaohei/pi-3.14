import type { PiHostEvent, PiHostState, PiTurnResult } from "@pi-3.14/model";

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
  steer(input: PiPromptInput | string): Promise<void>;
  followUp(input: PiPromptInput | string): Promise<void>;
  abort(): Promise<void>;
  getState(): Promise<PiHostState>;
  newSession(options?: { parentSession?: string }): Promise<PiSessionReplacementResult>;
  switchSession(sessionPath: string): Promise<PiSessionReplacementResult>;
  fork(entryId: string): Promise<PiForkResult>;
  dispose(): Promise<void>;
}

export function promptText(input: PiPromptInput | string): string {
  return typeof input === "string" ? input : input.text;
}
