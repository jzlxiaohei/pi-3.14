/**
 * PI host utility process entry.
 *
 * Owns EmbeddedPiHost only — no BrowserWindow, dialogs, or task store.
 * Speaks the PiHost* message protocol with the Electron main process.
 */
import { randomUUID } from "node:crypto";
import type { PiHostState, PiTurnResult } from "@pi-3.14/model";
import type { PiHost } from "@pi-3.14/runtime";
import {
  createEmbeddedPiHost,
  createSessionAutoApprove,
  type SessionAutoApprove,
} from "@pi-3.14/runtime/embedded";
import type {
  PiHostCommand,
  PiHostProcessMessage,
  PiHostToolApprovalRequestMessage,
} from "../../shared/desktop-contracts";

type ParentPort = {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(message: PiHostProcessMessage): void;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;

if (!parentPort) {
  throw new Error("PI host process requires Electron utilityProcess parentPort");
}

let host: PiHost | null = null;
let sessionAutoApprove: SessionAutoApprove | null = null;
const pendingApprovals = new Map<
  string,
  {
    resolve: (value: { approved: boolean; reason?: string }) => void;
    timer: NodeJS.Timeout;
  }
>();

parentPort.on("message", (message) => {
  const command = unwrapCommand(message);
  if (!command) {
    console.error("[pi-host] ignoring malformed parent message");
    return;
  }
  void handleCommand(command);
});

parentPort.postMessage({ type: "ready" });

process.on("uncaughtException", (error) => {
  console.error("[pi-host] uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[pi-host] unhandledRejection", reason);
});

async function handleCommand(command: PiHostCommand): Promise<void> {
  try {
    switch (command.type) {
      case "create": {
        if (host) {
          await host.dispose().catch(() => {});
          host = null;
        }
        rejectAllApprovals("Host recreated");
        sessionAutoApprove?.reset();
        sessionAutoApprove = createSessionAutoApprove((request) => requestToolApproval(request));
        host = await createEmbeddedPiHost({
          cwd: command.cwd,
          ...(command.sessionPath ? { sessionPath: command.sessionPath } : {}),
          toolApproval: sessionAutoApprove,
        });
        const state = await host.getState();
        replyOk(command.id, state);
        return;
      }
      case "prompt": {
        const active = requireHost();
        const turn = active.prompt(command.text);
        for await (const event of turn.events) {
          parentPort!.postMessage({ type: "event", event });
        }
        const result = await turn.result;
        replyOk(command.id, result);
        return;
      }
      case "abort": {
        rejectAllApprovals("Aborted");
        await host?.abort();
        replyOk(command.id, { aborted: true });
        return;
      }
      case "get_state": {
        replyOk(command.id, await requireHost().getState());
        return;
      }
      case "dispose": {
        rejectAllApprovals("Host disposed");
        sessionAutoApprove?.reset();
        sessionAutoApprove = null;
        if (host) {
          await host.dispose().catch(() => {});
          host = null;
        }
        replyOk(command.id, { disposed: true });
        return;
      }
      case "tool_approval_reply": {
        const pending = pendingApprovals.get(command.approvalId);
        if (!pending) {
          console.error(`[pi-host] approval reply for unknown id ${command.approvalId}`);
          return;
        }
        clearTimeout(pending.timer);
        pendingApprovals.delete(command.approvalId);
        pending.resolve({
          approved: command.approved,
          ...(command.reason ? { reason: command.reason } : {}),
        });
        return;
      }
    }
  } catch (error) {
    console.error("[pi-host] command failed", command.type, error);
    if (command.type === "tool_approval_reply") return;
    if (command.type === "prompt") {
      rejectAllApprovals("Prompt failed");
      await host?.abort().catch(() => {});
    }
    replyErr(command.id, error);
  }
}

function unwrapCommand(message: unknown): PiHostCommand | null {
  if (!message || typeof message !== "object") return null;
  const record = message as { data?: unknown };
  const candidate = "data" in record ? record.data : message;
  if (!candidate || typeof candidate !== "object") return null;
  if (!("type" in candidate)) return null;
  return candidate as PiHostCommand;
}

function requireHost(): PiHost {
  if (!host) throw new Error("PI host has not been created in the utility process");
  return host;
}

function replyOk(
  id: string,
  result: PiHostState | PiTurnResult | { disposed: true } | { aborted: true },
): void {
  parentPort!.postMessage({ id, ok: true, result });
}

function replyErr(id: string, error: unknown): void {
  parentPort!.postMessage({
    id,
    ok: false,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}

async function requestToolApproval(request: {
  toolCallId: string;
  toolName: string;
  args: import("@pi-3.14/model").JsonValue;
}): Promise<{ approved: boolean; reason?: string }> {
  const approvalId = randomUUID();
  const message: PiHostToolApprovalRequestMessage = {
    type: "tool_approval",
    approvalId,
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    args: request.args,
  };

  console.error(`[pi-host] requesting approval for ${request.toolName} (${approvalId})`);

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve({ approved: false, reason: "Tool approval timed out" });
    }, 120_000);
    pendingApprovals.set(approvalId, { resolve, timer });
    try {
      parentPort!.postMessage(message);
    } catch (error) {
      clearTimeout(timer);
      pendingApprovals.delete(approvalId);
      resolve({
        approved: false,
        reason: error instanceof Error ? error.message : "Failed to request tool approval",
      });
    }
  });
}

function rejectAllApprovals(reason: string): void {
  for (const [id, pending] of pendingApprovals) {
    clearTimeout(pending.timer);
    pending.resolve({ approved: false, reason });
    pendingApprovals.delete(id);
  }
}
