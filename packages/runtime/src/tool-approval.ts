import type { JsonValue } from "@pi-3.14/model";

export type PiToolApprovalRequest = {
  toolCallId: string;
  toolName: string;
  args: JsonValue;
};

export type PiToolApprovalDecision = {
  approved: boolean;
  reason?: string;
};

export type PiToolApprovalHandler = (
  request: PiToolApprovalRequest,
) => Promise<PiToolApprovalDecision>;

export type SessionAutoApprove = PiToolApprovalHandler & {
  reset(): void;
  readonly unlocked: boolean;
};

/** Read-like tools skip interactive approval; everything else needs a decision. */
export function toolNeedsApproval(toolName: string): boolean {
  switch (toolName) {
    case "read":
    case "Read":
    case "ReadFile":
    case "grep":
    case "Grep":
    case "glob":
    case "Glob":
    case "list":
    case "ls":
      return false;
    default:
      return true;
  }
}

/**
 * After the first explicit Allow, approve the rest of this host binding without
 * prompting again. Call `reset()` when creating/switching sessions.
 */
export function createSessionAutoApprove(approve: PiToolApprovalHandler): SessionAutoApprove {
  let unlocked = false;
  const handler = (async (request) => {
    if (unlocked) return { approved: true };
    const decision = await approve(request);
    if (decision.approved) unlocked = true;
    return decision;
  }) as SessionAutoApprove;
  handler.reset = () => {
    unlocked = false;
  };
  Object.defineProperty(handler, "unlocked", {
    get: () => unlocked,
  });
  return handler;
}

/** Fail closed when the turn aborts while the UI is still deciding. */
export function raceApproval(
  approve: PiToolApprovalHandler,
  request: PiToolApprovalRequest,
  signal?: AbortSignal,
): Promise<PiToolApprovalDecision> {
  if (!signal) return approve(request);
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve({ approved: false, reason: "Aborted" });
      return;
    }
    const onAbort = () => {
      cleanup();
      resolve({ approved: false, reason: "Aborted" });
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    void approve(request).then(
      (decision) => {
        cleanup();
        resolve(decision);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
