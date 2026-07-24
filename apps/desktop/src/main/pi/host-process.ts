/**
 * PI host utility process entry.
 *
 * Owns EmbeddedPiHost only — no BrowserWindow, dialogs, or task store.
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
import { QUESTIONNAIRE_SYSTEM_PROMPT } from "./prompts/questionnaire-system-prompt";

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
        const ignored = new Set(
          (command.ignoredSkillNames ?? []).map((name) => name.trim()).filter(Boolean),
        );
        const appendSystemPrompt = [
          QUESTIONNAIRE_SYSTEM_PROMPT,
          ...(command.appendSystemPrompts ?? [])
            .map((part) => part.trim())
            .filter(Boolean),
        ];
        host = await createEmbeddedPiHost({
          cwd: command.cwd,
          ...(command.sessionPath ? { sessionPath: command.sessionPath } : {}),
          toolApproval: sessionAutoApprove,
          services: {
            resourceLoaderOptions: {
              appendSystemPrompt,
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
      case "continue_turn": {
        const active = requireHost();
        const turn = active.continueTurn();
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
      case "inspect_live": {
        replyOk(command.id, await requireHost().inspectLive());
        return;
      }
      case "navigate_tree": {
        replyOk(
          command.id,
          await requireHost().navigateTree(command.entryId, {
            summarize: command.summarize,
            ...(command.label ? { label: command.label } : {}),
          }),
        );
        return;
      }
      case "prepare_branch_summary": {
        replyOk(command.id, await requireHost().prepareBranchSummary());
        return;
      }
      case "get_prepared_branch_summary": {
        replyOk(command.id, await requireHost().getPreparedBranchSummary());
        return;
      }
      case "clear_prepared_branch_summary": {
        await requireHost().clearPreparedBranchSummary();
        replyOk(command.id, { ok: true });
        return;
      }
      case "list_models": {
        replyOk(command.id, await requireHost().listModels());
        return;
      }
      case "list_thinking_levels": {
        replyOk(command.id, await requireHost().listThinkingLevels());
        return;
      }
      case "set_model": {
        replyOk(command.id, await requireHost().setModel(command.provider, command.modelId));
        return;
      }
      case "set_thinking_level": {
        replyOk(command.id, await requireHost().setThinkingLevel(command.level));
        return;
      }
      case "set_auto_approve": {
        if (!sessionAutoApprove) {
          throw new Error("PI host has not been created in the utility process");
        }
        sessionAutoApprove.setUnlocked(command.unlocked);
        replyOk(command.id, { unlocked: sessionAutoApprove.unlocked });
        return;
      }
      case "get_auto_approve": {
        replyOk(command.id, { unlocked: sessionAutoApprove?.unlocked ?? false });
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
    if (command.type === "prompt" || command.type === "continue_turn") {
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
