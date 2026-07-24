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

export type ToolApprovalKind = "allow" | "ask" | "deny";

export type ToolApprovalVerdict = {
  kind: ToolApprovalKind;
  reason?: string;
};

export type SessionAutoApprove = PiToolApprovalHandler & {
  reset(): void;
  /** Explicit session unlock (Composer "Auto this chat"). */
  setUnlocked(unlocked: boolean): void;
  readonly unlocked: boolean;
};

/**
 * Classify whether a tool call can run without a prompt.
 * - allow: run
 * - ask: prompt unless the session is unlocked
 * - deny: hard block (circuit breaker) — never auto
 */
export function classifyToolApproval(toolName: string, args: JsonValue): ToolApprovalVerdict {
  const name = toolName.trim();
  if (isReadLikeTool(name)) return { kind: "allow" };

  if (isBashTool(name)) {
    return classifyBashCommand(bashCommandFromArgs(args));
  }

  // edit / write / other mutating tools
  return { kind: "ask" };
}

/** @deprecated Prefer classifyToolApproval(toolName, args). */
export function toolNeedsApproval(toolName: string): boolean {
  return classifyToolApproval(toolName, {}).kind !== "allow";
}

/**
 * After the first explicit Allow — or setUnlocked(true) — approve remaining
 * ask-tier calls for this host binding. Deny-tier circuit breakers never unlock.
 * Call `reset()` when creating/switching sessions.
 */
export function createSessionAutoApprove(approve: PiToolApprovalHandler): SessionAutoApprove {
  let unlocked = false;
  const handler = (async (request) => {
    const verdict = classifyToolApproval(request.toolName, request.args);
    if (verdict.kind === "allow") return { approved: true };
    if (verdict.kind === "deny") {
      return { approved: false, reason: verdict.reason ?? "Denied by policy" };
    }
    if (unlocked) return { approved: true };
    const decision = await approve(request);
    if (decision.approved) unlocked = true;
    return decision;
  }) as SessionAutoApprove;
  handler.reset = () => {
    unlocked = false;
  };
  handler.setUnlocked = (next) => {
    unlocked = next;
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

function isReadLikeTool(toolName: string): boolean {
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
      return true;
    default:
      return false;
  }
}

function isBashTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower === "bash" || lower === "shell" || lower === "terminal";
}

function bashCommandFromArgs(args: JsonValue): string {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  for (const key of ["command", "cmd", "script"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Classify a bash command. Compound commands (`&&` `;` `|` `||`) take the
 * strictest segment (deny > ask > allow).
 */
export function classifyBashCommand(command: string): ToolApprovalVerdict {
  const trimmed = command.trim();
  if (!trimmed) return { kind: "ask", reason: "Empty bash command" };

  let worst: ToolApprovalVerdict = { kind: "allow" };
  for (const segment of splitBashSegments(trimmed)) {
    const next = classifyBashSegment(segment);
    worst = stricterVerdict(worst, next);
    if (worst.kind === "deny") return worst;
  }
  return worst;
}

function classifyBashSegment(segment: string): ToolApprovalVerdict {
  const text = segment.trim();
  if (!text) return { kind: "allow" };
  const lower = text.toLowerCase();

  // Circuit breakers — hard deny even when session Auto is on.
  if (isDestructiveRootOrHomeRm(lower)) {
    return {
      kind: "deny",
      reason: "Refusing destructive rm targeting filesystem root or home",
    };
  }

  // Always ask: privilege / network / publish / remote / substitution.
  if (
    /\b(sudo|curl|wget|chmod|chown|dd|mkfs|shutdown|reboot)\b/.test(lower) ||
    /\b(npm|pnpm|yarn)\s+publish\b/.test(lower) ||
    /\bgit\s+push\b/.test(lower) ||
    /\b(docker|kubectl|ssh|scp)\b/.test(lower) ||
    /\$\(|`/.test(text)
  ) {
    return { kind: "ask" };
  }

  // Safe / common local commands.
  if (
    /^(git\s+(status|diff|log|branch|show|remote|rev-parse|describe)\b)/.test(lower) ||
    /^(npm|pnpm|yarn)\s+(test|run\s+test|run\s+lint|run\s+typecheck|run\s+check)\b/.test(lower) ||
    /^(tsc|eslint|prettier|node\s+--test|vitest|jest)\b/.test(lower) ||
    /^(ls|pwd|echo|cat|head|tail|wc|which|whoami|date|env|printenv|rg|fd|find)\b/.test(lower) ||
    /^(mkdir|touch)\b/.test(lower)
  ) {
    return { kind: "allow" };
  }

  return { kind: "ask" };
}

/** rm -rf / or rm -rf ~ (and close variants). */
function isDestructiveRootOrHomeRm(lower: string): boolean {
  if (!/\brm\b/.test(lower)) return false;
  if (!/(^|\s)-[a-z]*r[a-z]*f\b|(^|\s)-[a-z]*f[a-z]*r\b|(^|\s)--recursive\b/.test(lower)) {
    // Also catch separate -r -f
    if (!/(^|\s)-[a-z]*r\b/.test(lower) || !/(^|\s)-[a-z]*f\b/.test(lower)) return false;
  }
  // Targets: / or ~ or $HOME as a path argument
  if (/(^|\s)(\/|~|\$home|\$\{home\})(\s|$|;|&|\|)/i.test(lower)) return true;
  if (/(^|\s)(\/|~|\$home|\$\{home\})$/i.test(lower)) return true;
  return false;
}

function stricterVerdict(a: ToolApprovalVerdict, b: ToolApprovalVerdict): ToolApprovalVerdict {
  const rank = { allow: 0, ask: 1, deny: 2 } as const;
  return rank[b.kind] > rank[a.kind] ? b : a;
}

/** Split on && || ; | outside simple quotes. */
export function splitBashSegments(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (command.startsWith("&&", i) || command.startsWith("||", i)) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    if (char === ";" || char === "|") {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.length > 0 ? parts : [command.trim()];
}
