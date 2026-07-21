import type { SessionManager } from "@earendil-works/pi-coding-agent";

type SessionEntry = {
  id: string;
  parentId?: string | null;
  type?: string;
  message?: {
    role?: string;
    stopReason?: string;
    content?: unknown;
  };
};

/**
 * Drop broken mid-tool turns from the leaf path.
 *
 * Codex / OpenAI Responses skip aborted|error assistant messages on replay, but
 * still send following toolResults as function_call_output — that yields
 * "No tool call found for function call output". Branching before the broken
 * assistant is the safe recovery.
 */
export function repairOrphanedToolCalls(sessionManager: SessionManager): number {
  const branch = sessionManager.getBranch() as SessionEntry[];
  let branchTarget: string | null | undefined;
  let found = false;

  for (const entry of branch) {
    if (entry.type !== "message" || !entry.message) continue;
    const message = entry.message;
    if (message.role !== "assistant") continue;
    if (message.stopReason !== "aborted" && message.stopReason !== "error") continue;
    if (!hasToolCall(message.content)) continue;
    branchTarget = entry.parentId ?? null;
    found = true;
    break;
  }

  if (!found) return 0;
  if (branchTarget) sessionManager.branch(branchTarget);
  else sessionManager.resetLeaf();
  return 1;
}

function hasToolCall(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!block || typeof block !== "object") return false;
    return (block as { type?: string }).type === "toolCall";
  });
}
