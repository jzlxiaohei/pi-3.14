import type {
  JsonValue,
  PiHostEvent,
  PiHostState,
  PiLiveInspectSnapshot,
  PiLiveProviderRequest,
  PiModelOption,
  PiNavigateTreeResult,
  PiPreparedBranchSummary,
  PiStopReason,
  PiThinkingLevel,
  PiTurnResult,
} from "@pi-3.14/model";
import { toJsonValue } from "@pi-3.14/model";
import {
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionServicesOptions,
  SessionManager,
  convertToLlm,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  generateBranchSummary,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { AsyncQueue } from "./async-queue.js";
import {
  type PiForkResult,
  type PiHost,
  type PiHostCapabilities,
  type PiPromptInput,
  type PiSessionReplacementResult,
  type PiTurnHandle,
  promptText,
} from "./contracts.js";
import { messageStopReason, messageText, projectPiEvent } from "./events.js";
import { formatProviderErrorMessage } from "./format-error.js";
import { repairOrphanedToolCalls } from "./repair-orphaned-tools.js";
import {
  raceApproval,
  type PiToolApprovalHandler,
} from "./tool-approval.js";

export type {
  PiToolApprovalDecision,
  PiToolApprovalHandler,
  PiToolApprovalRequest,
  SessionAutoApprove,
  ToolApprovalKind,
  ToolApprovalVerdict,
} from "./tool-approval.js";
export {
  classifyBashCommand,
  classifyToolApproval,
  createSessionAutoApprove,
  raceApproval,
  splitBashSegments,
  toolNeedsApproval,
} from "./tool-approval.js";
export { repairOrphanedToolCalls } from "./repair-orphaned-tools.js";

export interface EmbeddedPiHostOptions {
  cwd?: string;
  /** Resume an existing JSONL session instead of creating a new one. */
  sessionPath?: string;
  agentDir?: string;
  sessionManager?: SessionManager;
  services?: Omit<CreateAgentSessionServicesOptions, "cwd" | "agentDir">;
  session?: Omit<
    CreateAgentSessionFromServicesOptions,
    "services" | "sessionManager" | "sessionStartEvent"
  >;
  /**
   * Use this escape hatch for custom ResourceLoaders or cwd-sensitive model
   * resolution that cannot be represented by the default service options.
   */
  createRuntime?: CreateAgentSessionRuntimeFactory;
  /**
   * Gate tool calls. Prefer wrapping with `createSessionAutoApprove` so
   * allow/ask/deny policy + session unlock live in one place. Fail closed when
   * the handler denies or throws.
   */
  toolApproval?: PiToolApprovalHandler;
}

type WireCaptureStore = {
  last: PiLiveProviderRequest | null;
};

type PreparedSummaryStore = {
  pending: PiPreparedBranchSummary | null;
};

interface ActiveTurn {
  unsubscribe: () => void;
}

export class EmbeddedPiHost implements PiHost {
  readonly capabilities: PiHostCapabilities = {
    execution: "embedded",
    processIsolation: false,
    customTools: true,
    rawSessionAccess: true,
    settledEvent: false,
  };

  private active?: ActiveTurn;
  private disposed = false;

  constructor(
    readonly runtime: AgentSessionRuntime,
    private readonly wireCapture: WireCaptureStore = { last: null },
    private readonly preparedSummary: PreparedSummaryStore = { pending: null },
  ) {}

  get session(): AgentSession {
    return this.runtime.session;
  }

  prompt(input: PiPromptInput | string): PiTurnHandle {
    return this.beginTurn((session) => session.prompt(promptText(input)));
  }

  continueTurn(): PiTurnHandle {
    return this.beginTurn(async (session) => {
      // Match session leaf path into agent transcript.
      const context = session.sessionManager.buildSessionContext();
      // agent.continue() requires the last message to be user or toolResult — not
      // assistant. Failed/aborted assistants stay on the JSONL path (leaf unchanged)
      // so the UI does not "leave the branch"; we only drop them from agent state,
      // same as PI AgentSession._prepareRetry.
      session.agent.state.messages = stripTrailingFailedAssistants(context.messages);
      const last = session.agent.state.messages.at(-1);
      if (!last) {
        throw new Error("No messages to continue from");
      }
      if (last.role === "assistant") {
        throw new Error(
          "Cannot retry: latest turn already completed successfully. Edit the user message to branch.",
        );
      }
      await session.agent.continue();
    });
  }

  async steer(input: PiPromptInput | string): Promise<void> {
    this.assertAvailable();
    await this.session.steer(promptText(input));
  }

  async followUp(input: PiPromptInput | string): Promise<void> {
    this.assertAvailable();
    await this.session.followUp(promptText(input));
  }

  async abort(): Promise<void> {
    if (!this.disposed) await this.session.abort();
  }

  async getState(): Promise<PiHostState> {
    this.assertAvailable();
    const session = this.session;
    return {
      sessionId: session.sessionId,
      sessionPath: session.sessionFile ?? null,
      leafEntryId: session.sessionManager.getLeafId(),
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      model: session.model ? { provider: session.model.provider, id: session.model.id } : null,
      thinkingLevel: session.thinkingLevel,
    };
  }

  async listModels(): Promise<PiModelOption[]> {
    this.assertAvailable();
    const models = await this.session.modelRuntime.getAvailable();
    return models.map((model) => ({
      provider: model.provider,
      id: model.id,
      ...("name" in model && typeof model.name === "string" ? { name: model.name } : {}),
    }));
  }

  async setModel(provider: string, modelId: string): Promise<PiHostState> {
    this.assertAvailable();
    const model = this.session.modelRuntime.getModel(provider, modelId);
    if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
    await this.session.setModel(model);
    return this.getState();
  }

  async listThinkingLevels(): Promise<PiThinkingLevel[]> {
    this.assertAvailable();
    return this.session.getAvailableThinkingLevels() as PiThinkingLevel[];
  }

  async setThinkingLevel(level: PiThinkingLevel): Promise<PiHostState> {
    this.assertAvailable();
    this.session.setThinkingLevel(level);
    return this.getState();
  }

  async newSession(options?: { parentSession?: string }): Promise<PiSessionReplacementResult> {
    this.assertReplaceable();
    return this.runtime.newSession(options);
  }

  async switchSession(sessionPath: string): Promise<PiSessionReplacementResult> {
    this.assertReplaceable();
    return this.runtime.switchSession(sessionPath);
  }

  async fork(entryId: string): Promise<PiForkResult> {
    this.assertReplaceable();
    const result = await this.runtime.fork(entryId);
    return {
      cancelled: result.cancelled,
      ...(result.selectedText === undefined ? {} : { selectedText: result.selectedText }),
    };
  }

  async inspectLive(options?: { detail?: "summary" | "full" }): Promise<PiLiveInspectSnapshot> {
    this.assertAvailable();
    const session = this.session;
    const stats = session.getSessionStats();
    const contextUsage = session.getContextUsage();
    const detail = options?.detail ?? "full";
    const skills = session.resourceLoader.getSkills().skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
    }));
    const tools = session.getAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
    const toolNames = session.getActiveToolNames();
    const base = {
      systemPrompt: session.systemPrompt,
      activeToolNames: toolNames,
      contextUsage: contextUsage
        ? {
            tokens: contextUsage.tokens,
            contextWindow: contextUsage.contextWindow,
            percent: contextUsage.percent,
          }
        : null,
      sessionStats: {
        userMessages: stats.userMessages,
        assistantMessages: stats.assistantMessages,
        toolCalls: stats.toolCalls,
        toolResults: stats.toolResults,
        totalMessages: stats.totalMessages,
        tokens: { ...stats.tokens },
        cost: stats.cost,
      },
      skills,
      tools,
    };
    // Summary: HUD / meters only — convertToLlm + full transcript is multi‑MB and
    // freezes the host + main IPC path after a quick failed Retry.
    if (detail === "summary") {
      return {
        ...base,
        sessionMessages: [],
        assembled: {
          systemPrompt: session.systemPrompt,
          messages: [],
          toolNames,
        },
        lastProviderRequest: null,
      };
    }
    const sessionContext = session.sessionManager.buildSessionContext();
    const sessionMessages = toJsonValue(sessionContext.messages);
    const assembledMessages = toJsonValue(convertToLlm(sessionContext.messages));
    return {
      ...base,
      sessionMessages,
      assembled: {
        systemPrompt: session.systemPrompt,
        messages: assembledMessages,
        toolNames,
      },
      lastProviderRequest: this.wireCapture.last,
    };
  }

  async navigateTree(
    entryId: string,
    options?: { summarize?: boolean; label?: string },
  ): Promise<PiNavigateTreeResult> {
    this.assertAvailable();
    if (this.active) {
      await this.session.abort().catch(() => {});
      for (let attempt = 0; attempt < 100 && this.active; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    this.assertReplaceable();
    const fromLeafId = this.session.sessionManager.getLeafId();
    const summarize = options?.summarize ?? false;
    const result = await this.session.navigateTree(entryId, {
      summarize,
      ...(options?.label ? { label: options.label } : {}),
    });
    if (
      !result.cancelled &&
      summarize &&
      this.preparedSummary.pending &&
      this.preparedSummary.pending.fromLeafId === fromLeafId
    ) {
      this.preparedSummary.pending = null;
    }
    return {
      cancelled: result.cancelled,
      ...(result.editorText !== undefined ? { editorText: result.editorText } : {}),
      ...(result.aborted !== undefined ? { aborted: result.aborted } : {}),
    };
  }

  async prepareBranchSummary(): Promise<PiPreparedBranchSummary> {
    this.assertAvailable();
    if (this.active) {
      await this.session.abort().catch(() => {});
      for (let attempt = 0; attempt < 100 && this.active; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    this.assertReplaceable();

    const session = this.session;
    const leafId = session.sessionManager.getLeafId();
    if (!leafId) throw new Error("No leaf to summarize");
    const model = session.model;
    if (!model) throw new Error("No model available for summarization");

    const entries = collectEntriesForPrepare(session.sessionManager, leafId);
    if (entries.length === 0) throw new Error("Nothing to summarize on the current path");

    const auth = await getSummarizationAuth(session, model);
    const reserveTokens = session.settingsManager.getBranchSummarySettings().reserveTokens;
    const controller = new AbortController();
    const result = await generateBranchSummary(entries, {
      model,
      apiKey: auth.apiKey,
      headers: auth.headers,
      env: auth.env,
      signal: controller.signal,
      reserveTokens,
      streamFn: session.agent.streamFunction,
    });
    if (result.aborted) throw new Error("Branch summary aborted");
    if (result.error) throw new Error(result.error);
    if (!result.summary?.trim()) throw new Error("Empty branch summary");

    const prepared: PiPreparedBranchSummary = {
      fromLeafId: leafId,
      summary: result.summary,
      preparedAt: Date.now(),
      details: {
        readFiles: result.readFiles ?? [],
        modifiedFiles: result.modifiedFiles ?? [],
      },
    };
    this.preparedSummary.pending = prepared;
    return prepared;
  }

  async getPreparedBranchSummary(): Promise<PiPreparedBranchSummary | null> {
    this.assertAvailable();
    const pending = this.preparedSummary.pending;
    if (!pending) return null;
    const leafId = this.session.sessionManager.getLeafId();
    if (pending.fromLeafId !== leafId) return null;
    return pending;
  }

  async clearPreparedBranchSummary(): Promise<void> {
    this.assertAvailable();
    this.preparedSummary.pending = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.unsubscribe();
    this.active = undefined;
    await this.runtime.session.abort().catch(() => {});
    await this.runtime.dispose();
  }

  private beginTurn(
    run: (session: AgentSession) => Promise<void>,
  ): PiTurnHandle {
    this.assertAvailable();

    const events = new AsyncQueue<PiHostEvent>();
    const session = this.session;
    let lastText = "";
    let streamText = "";
    let latestNonEmptyText = "";
    let lastStopReason: PiStopReason | undefined;

    // Settle any prior turn first (async). UI may unlock early between PI auto-retry
    // gaps while this.active is still set — abort + wait instead of hard-failing.
    const result = (async (): Promise<PiTurnResult> => {
      await this.settleActiveTurn();
      this.assertAvailable();
      if (this.active) throw new Error("A PI turn is already running");

      const active: ActiveTurn = {
        unsubscribe: session.subscribe((event) => {
          const projected = projectPiEvent(event);
          if (projected) events.push(projected);
          if (
            event.type === "message_start" &&
            "role" in event.message &&
            event.message.role === "assistant"
          ) {
            streamText = "";
          }
          if (projected?.type === "text_delta") {
            streamText += projected.text;
            if (streamText) latestNonEmptyText = streamText;
          }
          if (event.type !== "message_end") return;
          const reason = messageStopReason(event.message);
          if (!reason) return;
          lastStopReason = reason;
          if (reason !== "toolUse") {
            lastText = messageText(event.message) || streamText || latestNonEmptyText;
          }
        }),
      };
      this.active = active;

      let thrown: unknown;
      try {
        await run(session);
      } catch (error) {
        thrown = error;
      } finally {
        active.unsubscribe();
        if (this.active === active) this.active = undefined;
      }

      const observed = {
        text: lastText,
        stopReason: lastStopReason,
      };
      const fallback = lastAssistant(session);
      const reason = terminalReason(observed.stopReason ?? fallback.stopReason, thrown);
      const turnResult: PiTurnResult = {
        stopReason: reason,
        text: observed.text || fallback.text,
        sessionId: session.sessionId,
        sessionPath: session.sessionFile ?? null,
        leafEntryId: session.sessionManager.getLeafId(),
        ...(reason === "error"
          ? {
              errorMessage: resolveTurnErrorMessage(
                thrown,
                session.agent.state.errorMessage,
              ),
            }
          : {}),
      };
      events.close();
      return turnResult;
    })();

    return { events, result };
  }

  /**
   * Abort an in-flight host turn and wait for `this.active` to clear.
   * Prevents "A PI turn is already running" when the UI unlocks early (auto-retry
   * gaps report isStreaming=false while EmbeddedPiHost still owns a turn).
   */
  private async settleActiveTurn(): Promise<void> {
    if (!this.active) return;
    await this.session.abort().catch(() => {});
    for (let attempt = 0; attempt < 150 && this.active; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (this.active) {
      try {
        this.active.unsubscribe();
      } catch {
        /* ignore */
      }
      this.active = undefined;
    }
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("PI host is disposed");
  }

  private assertReplaceable(): void {
    this.assertAvailable();
    if (this.active) throw new Error("Cannot replace a PI session while a turn is running");
  }
}

export async function createEmbeddedPiHost(
  options: EmbeddedPiHostOptions = {},
): Promise<EmbeddedPiHost> {
  const cwd = options.cwd ?? process.cwd();
  const agentDir = options.agentDir ?? getAgentDir();
  const wireCapture: WireCaptureStore = { last: null };
  const preparedSummary: PreparedSummaryStore = { pending: null };
  const priorFactories = options.services?.resourceLoaderOptions?.extensionFactories ?? [];
  const createRuntime: CreateAgentSessionRuntimeFactory =
    options.createRuntime ??
    (async ({ cwd: runtimeCwd, agentDir: runtimeAgentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        ...options.services,
        cwd: runtimeCwd,
        agentDir: runtimeAgentDir,
        resourceLoaderOptions: {
          ...(options.services?.resourceLoaderOptions ?? {}),
          extensionFactories: [
            ...priorFactories,
            {
              name: "pie-wire-capture",
              factory: (pi) => {
                pi.on("before_provider_request", (event) => {
                  wireCapture.last = {
                    at: Date.now(),
                    payload: toJsonValue(event.payload) as JsonValue,
                  };
                });
              },
            },
            {
              name: "pie-prepared-branch-summary",
              factory: (pi) => {
                pi.on("session_before_tree", (event) => {
                  const pending = preparedSummary.pending;
                  if (!event.preparation.userWantsSummary || !pending) return;
                  if (pending.fromLeafId !== event.preparation.oldLeafId) return;
                  return {
                    summary: {
                      summary: pending.summary,
                      details: pending.details ?? { readFiles: [], modifiedFiles: [] },
                    },
                  };
                });
              },
            },
          ],
        },
      });
      return {
        ...(await createAgentSessionFromServices({
          ...options.session,
          services,
          sessionManager,
          sessionStartEvent,
        })),
        services,
        diagnostics: services.diagnostics,
      };
    });
  const sessionManager =
    options.sessionManager ??
    (options.sessionPath
      ? SessionManager.open(options.sessionPath, undefined, cwd)
      : SessionManager.create(cwd));
  repairOrphanedToolCalls(sessionManager);
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager,
  });
  const host = new EmbeddedPiHost(runtime, wireCapture, preparedSummary);
  if (options.toolApproval) {
    installToolApprovalGate(host.session, options.toolApproval);
  }
  return host;
}

/** Summarize from nearest fork child (or path root) to the current leaf. */
function collectEntriesForPrepare(sessionManager: SessionManager, leafId: string) {
  const path = sessionManager.getBranch(leafId);
  let cutIndex = 0;
  for (let i = path.length - 1; i >= 1; i -= 1) {
    const entry = path[i]!;
    const parentId = entry.parentId;
    if (parentId == null) continue;
    if (sessionManager.getChildren(parentId).length > 1) {
      cutIndex = i;
      break;
    }
  }
  return path.slice(cutIndex);
}

async function getSummarizationAuth(
  session: AgentSession,
  model: NonNullable<AgentSession["model"]>,
): Promise<{
  apiKey?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}> {
  const withAuth = session as unknown as {
    _getSummarizationRequestAuth?: (model: NonNullable<AgentSession["model"]>) => Promise<{
      apiKey?: string;
      headers?: Record<string, string>;
      env?: Record<string, string>;
    }>;
  };
  if (typeof withAuth._getSummarizationRequestAuth === "function") {
    return withAuth._getSummarizationRequestAuth(model);
  }
  return {};
}

function installToolApprovalGate(session: AgentSession, approve: PiToolApprovalHandler): void {
  const agent = session.agent as {
    beforeToolCall?: (
      ctx: {
        toolCall: { id: string; name: string };
        args: unknown;
      },
      signal?: AbortSignal,
    ) => Promise<{ block?: boolean; reason?: string } | undefined>;
  };
  const prior = agent.beforeToolCall?.bind(agent);
  agent.beforeToolCall = async (ctx, signal) => {
    const upstream = prior ? await prior(ctx, signal) : undefined;
    if (upstream?.block) return upstream;
    if (signal?.aborted) {
      return { block: true, reason: "Aborted" };
    }
    try {
      // Policy (allow/ask/deny + session unlock) lives in the approval handler.
      const decision = await raceApproval(
        approve,
        {
          toolCallId: ctx.toolCall.id,
          toolName: ctx.toolCall.name,
          args: toJsonValue(ctx.args),
        },
        signal,
      );
      if (decision.approved) return upstream;
      return { block: true, reason: decision.reason ?? "Denied by user" };
    } catch (error) {
      return {
        block: true,
        reason: error instanceof Error ? error.message : "Tool approval failed closed",
      };
    }
  };
}

function lastAssistant(session: AgentSession): { text: string; stopReason?: PiStopReason } {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message && "role" in message && message.role === "assistant") {
      return {
        text: messageText(message),
        ...(messageStopReason(message) ? { stopReason: messageStopReason(message) } : {}),
      };
    }
  }
  return { text: "" };
}

function terminalReason(
  reason: PiStopReason | undefined,
  thrown: unknown,
): PiTurnResult["stopReason"] {
  if (thrown !== undefined) return "error";
  if (reason === "stop" || reason === "length" || reason === "aborted" || reason === "error") {
    return reason;
  }
  return "error";
}

function resolveTurnErrorMessage(
  thrown: unknown,
  sessionError: string | null | undefined,
): string {
  if (thrown !== undefined) return formatProviderErrorMessage(thrown);
  if (typeof sessionError === "string" && sessionError.trim()) {
    // Session may already store a short SDK message; re-classify for a hint.
    return formatProviderErrorMessage(sessionError.trim());
  }
  return "PI turn failed";
}

/**
 * Drop trailing error/aborted assistant messages so `agent.continue()` is legal
 * without moving the SessionManager leaf (avoids path/branch UI jumps).
 */
function stripTrailingFailedAssistants<T extends { role?: string; stopReason?: string }>(
  messages: T[],
): T[] {
  let end = messages.length;
  while (end > 0) {
    const last = messages[end - 1]!;
    if (
      last.role === "assistant" &&
      (last.stopReason === "error" || last.stopReason === "aborted")
    ) {
      end -= 1;
      continue;
    }
    break;
  }
  return end === messages.length ? messages : messages.slice(0, end);
}
