/**
 * PI host utility process entry.
 *
 * Owns many EmbeddedPiHost instances (keyed by hostId / agent id) in one process —
 * no BrowserWindow, dialogs, or task store.
 * Speaks the PiHost* message protocol with the Electron main process.
 */
import { randomUUID } from "node:crypto";
import type { PiHost } from "@pi-3.14/runtime";
import {
  createEmbeddedPiHost,
  createSessionAutoApprove,
  type SessionAutoApprove,
} from "@pi-3.14/runtime/embedded";
import type {
  PiHostCommand,
  PiHostProcessMessage,
  PiHostResponse,
  PiHostToolApprovalRequestMessage,
} from "../../shared/desktop-contracts";
import { buildHostSystemPromptOptions } from "./host-system-prompt";
import { QUESTIONNAIRE_SYSTEM_PROMPT } from "./prompts/questionnaire-system-prompt";

type ParentPort = {
  on(event: "message", listener: (message: { data: unknown }) => void): void;
  postMessage(message: PiHostProcessMessage): void;
};

type HostSlot = {
  host: PiHost;
  sessionAutoApprove: SessionAutoApprove;
};

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort;

if (!parentPort) {
  throw new Error("PI host process requires Electron utilityProcess parentPort");
}

/** Concurrent sessions: one EmbeddedPiHost per agent (hostId). */
const hosts = new Map<string, HostSlot>();
const pendingApprovals = new Map<
  string,
  {
    hostId: string;
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
        const hostId = command.hostId;
        await disposeSlot(hostId, "Host recreated");
        const sessionAutoApprove = createSessionAutoApprove((request) =>
          requestToolApproval(hostId, request),
        );
        const ignored = new Set(
          (command.ignoredSkillNames ?? []).map((name) => name.trim()).filter(Boolean),
        );
        const assembled = buildHostSystemPromptOptions({
          rolePrompt: command.rolePrompt ?? "",
          productAppends: [QUESTIONNAIRE_SYSTEM_PROMPT],
        });
        const host = await createEmbeddedPiHost({
          cwd: command.cwd,
          ...(command.sessionPath ? { sessionPath: command.sessionPath } : {}),
          toolApproval: sessionAutoApprove,
          services: {
            resourceLoaderOptions: {
              ...assembled,
              ...(ignored.size > 0
                ? {
                    skillsOverride: (current) => ({
                      skills: current.skills.filter((skill) => !ignored.has(skill.name)),
                      diagnostics: current.diagnostics,
                    }),
                  }
                : {}),
            },
          },
        });
        hosts.set(hostId, { host, sessionAutoApprove });
        const state = await host.getState();
        replyOk(command.id, state);
        return;
      }
      case "prompt": {
        const slot = requireHost(command.hostId);
        const turn = slot.host.prompt(command.text);
        for await (const event of turn.events) {
          parentPort!.postMessage({ type: "event", hostId: command.hostId, event });
        }
        const result = await turn.result;
        replyOk(command.id, result);
        return;
      }
      case "continue_turn": {
        const slot = requireHost(command.hostId);
        const turn = slot.host.continueTurn();
        for await (const event of turn.events) {
          parentPort!.postMessage({ type: "event", hostId: command.hostId, event });
        }
        const result = await turn.result;
        replyOk(command.id, result);
        return;
      }
      case "abort": {
        rejectApprovalsForHost(command.hostId, "Aborted");
        await hosts.get(command.hostId)?.host.abort();
        replyOk(command.id, { aborted: true });
        return;
      }
      case "get_state": {
        replyOk(command.id, await requireHost(command.hostId).host.getState());
        return;
      }
      case "inspect_live": {
        replyOk(
          command.id,
          await requireHost(command.hostId).host.inspectLive({
            detail: command.detail === "summary" ? "summary" : "full",
          }),
        );
        return;
      }
      case "navigate_tree": {
        replyOk(
          command.id,
          await requireHost(command.hostId).host.navigateTree(command.entryId, {
            summarize: command.summarize,
            ...(command.label ? { label: command.label } : {}),
          }),
        );
        return;
      }
      case "prepare_branch_summary": {
        replyOk(command.id, await requireHost(command.hostId).host.prepareBranchSummary());
        return;
      }
      case "get_prepared_branch_summary": {
        replyOk(command.id, await requireHost(command.hostId).host.getPreparedBranchSummary());
        return;
      }
      case "clear_prepared_branch_summary": {
        await requireHost(command.hostId).host.clearPreparedBranchSummary();
        replyOk(command.id, { ok: true });
        return;
      }
      case "list_models": {
        replyOk(command.id, await requireHost(command.hostId).host.listModels());
        return;
      }
      case "list_thinking_levels": {
        replyOk(command.id, await requireHost(command.hostId).host.listThinkingLevels());
        return;
      }
      case "set_model": {
        replyOk(
          command.id,
          await requireHost(command.hostId).host.setModel(command.provider, command.modelId),
        );
        return;
      }
      case "set_thinking_level": {
        replyOk(
          command.id,
          await requireHost(command.hostId).host.setThinkingLevel(command.level),
        );
        return;
      }
      case "set_auto_approve": {
        const slot = requireHost(command.hostId);
        slot.sessionAutoApprove.setUnlocked(command.unlocked);
        replyOk(command.id, { unlocked: slot.sessionAutoApprove.unlocked });
        return;
      }
      case "get_auto_approve": {
        const slot = hosts.get(command.hostId);
        replyOk(command.id, { unlocked: slot?.sessionAutoApprove.unlocked ?? false });
        return;
      }
      case "dispose": {
        if (command.hostId) {
          await disposeSlot(command.hostId, "Host disposed");
        } else {
          await disposeAll("Host disposed");
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
    if (command.type === "prompt" || command.type === "continue_turn") {
      const hostId = "hostId" in command ? command.hostId : undefined;
      if (hostId) {
        rejectApprovalsForHost(hostId, "Prompt failed");
        await hosts.get(hostId)?.host.abort().catch(() => {});
      }
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

function requireHost(hostId: string): HostSlot {
  const slot = hosts.get(hostId);
  if (!slot) {
    throw new Error(`PI host ${hostId} has not been created in the utility process`);
  }
  return slot;
}

async function disposeSlot(hostId: string, reason: string): Promise<void> {
  rejectApprovalsForHost(hostId, reason);
  const slot = hosts.get(hostId);
  if (!slot) return;
  hosts.delete(hostId);
  slot.sessionAutoApprove.reset();
  await slot.host.dispose().catch(() => {});
}

async function disposeAll(reason: string): Promise<void> {
  const ids = [...hosts.keys()];
  for (const hostId of ids) {
    await disposeSlot(hostId, reason);
  }
}

function replyOk(id: string, result: Extract<PiHostResponse, { ok: true }>["result"]): void {
  parentPort!.postMessage({ id, ok: true, result });
}

function replyErr(id: string, error: unknown): void {
  parentPort!.postMessage({
    id,
    ok: false,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}

async function requestToolApproval(
  hostId: string,
  request: {
    toolCallId: string;
    toolName: string;
    args: import("@pi-3.14/model").JsonValue;
  },
): Promise<{ approved: boolean; reason?: string }> {
  const approvalId = randomUUID();
  const message: PiHostToolApprovalRequestMessage = {
    type: "tool_approval",
    hostId,
    approvalId,
    toolCallId: request.toolCallId,
    toolName: request.toolName,
    args: request.args,
  };

  console.error(`[pi-host] requesting approval for ${request.toolName} (${approvalId}) host=${hostId}`);

  return await new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve({ approved: false, reason: "Tool approval timed out" });
    }, 120_000);
    pendingApprovals.set(approvalId, { hostId, resolve, timer });
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

function rejectApprovalsForHost(hostId: string, reason: string): void {
  for (const [id, pending] of pendingApprovals) {
    if (pending.hostId !== hostId) continue;
    clearTimeout(pending.timer);
    pending.resolve({ approved: false, reason });
    pendingApprovals.delete(id);
  }
}
