import { join } from "node:path";
import type {
  PiHostEvent,
  PiHostState,
  PiLiveInspectSnapshot,
  PiModelOption,
  PiNavigateTreeResult,
  PiStopReason,
  PiThinkingLevel,
  PiTurnResult,
} from "@pi-3.14/model";
import {
  RpcClient,
  type RpcClientOptions,
  type RpcSessionState,
  getPackageDir,
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

export interface RpcPiHostOptions extends RpcClientOptions {
  /** Safety bound for a turn that never reaches a terminal state. */
  turnTimeoutMs?: number;
  /** Polls state so an otherwise silent child-process exit rejects promptly. */
  processCheckIntervalMs?: number;
}

interface ActiveRpcTurn {
  events: AsyncQueue<PiHostEvent>;
  unsubscribe: () => void;
  resolve: (result: PiTurnResult) => void;
  lastText: string;
  streamText: string;
  latestNonEmptyText: string;
  lastStopReason?: PiStopReason;
  timeout: ReturnType<typeof setTimeout>;
  processCheck?: ReturnType<typeof setInterval>;
  settling: boolean;
  settled: boolean;
}

export class RpcPiHost implements PiHost {
  readonly capabilities: PiHostCapabilities = {
    execution: "rpc",
    processIsolation: true,
    customTools: false,
    rawSessionAccess: false,
    settledEvent: false,
  };

  private active?: ActiveRpcTurn;
  private disposed = false;

  constructor(
    readonly client: RpcClient,
    private readonly turnTimeoutMs = 30 * 60_000,
    private readonly processCheckIntervalMs = 1_000,
  ) {}

  prompt(input: PiPromptInput | string): PiTurnHandle {
    this.assertAvailable();
    if (this.active) throw new Error("A PI turn is already running");

    const events = new AsyncQueue<PiHostEvent>();
    let resolveResult!: (result: PiTurnResult) => void;
    const result = new Promise<PiTurnResult>((resolve) => {
      resolveResult = resolve;
    });
    const active: ActiveRpcTurn = {
      events,
      resolve: resolveResult,
      lastText: "",
      streamText: "",
      latestNonEmptyText: "",
      timeout: setTimeout(() => {
        void this.abortTimedOutTurn(active);
      }, this.turnTimeoutMs),
      settling: false,
      settled: false,
      unsubscribe: () => {},
    };
    if (this.processCheckIntervalMs > 0) {
      active.processCheck = setInterval(() => {
        void this.client.getState().catch((error: unknown) => {
          void this.finish(active, "error", errorMessage(error));
        });
      }, this.processCheckIntervalMs);
      active.processCheck.unref();
    }
    active.unsubscribe = this.client.onEvent((event) => {
      const projected = projectPiEvent(event);
      if (projected) events.push(projected);
      const source = event as unknown as Record<string, unknown>;
      if (
        source.type === "message_start" &&
        messageRole(source.message) === "assistant"
      ) {
        active.streamText = "";
      }
      if (projected?.type === "text_delta") {
        active.streamText += projected.text;
        if (active.streamText) active.latestNonEmptyText = active.streamText;
      }
      if (source.type === "message_end") {
        const reason = messageStopReason(source.message);
        if (reason) {
          active.lastStopReason = reason;
          if (reason !== "toolUse") {
            active.lastText =
              messageText(source.message) ||
              active.streamText ||
              active.latestNonEmptyText;
          }
        }
      }
      if (source.type === "agent_end" && source.willRetry !== true) {
        void this.settleIfIdle(active);
      }
    });
    this.active = active;

    void this.client.prompt(promptText(input)).catch((error: unknown) => {
      void this.finish(active, "error", errorMessage(error));
    });
    return { events, result };
  }

  async steer(input: PiPromptInput | string): Promise<void> {
    this.assertAvailable();
    await this.client.steer(promptText(input));
  }

  async followUp(input: PiPromptInput | string): Promise<void> {
    this.assertAvailable();
    await this.client.followUp(promptText(input));
  }

  async abort(): Promise<void> {
    if (!this.disposed) await this.client.abort();
  }

  async getState(): Promise<PiHostState> {
    this.assertAvailable();
    return projectState(await this.client.getState());
  }

  async listModels(): Promise<PiModelOption[]> {
    this.assertAvailable();
    const models = await this.client.getAvailableModels();
    return models.map((model) => ({
      provider: model.provider,
      id: model.id,
    }));
  }

  async setModel(provider: string, modelId: string): Promise<PiHostState> {
    this.assertAvailable();
    await this.client.setModel(provider, modelId);
    return this.getState();
  }

  async listThinkingLevels(): Promise<PiThinkingLevel[]> {
    this.assertAvailable();
    // RPC has no list API; expose the full clampable set.
    return ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  }

  async setThinkingLevel(level: PiThinkingLevel): Promise<PiHostState> {
    this.assertAvailable();
    await this.client.setThinkingLevel(level);
    return this.getState();
  }

  async newSession(options?: { parentSession?: string }): Promise<PiSessionReplacementResult> {
    this.assertReplaceable();
    return this.client.newSession(options?.parentSession);
  }

  async switchSession(sessionPath: string): Promise<PiSessionReplacementResult> {
    this.assertReplaceable();
    return this.client.switchSession(sessionPath);
  }

  async fork(entryId: string): Promise<PiForkResult> {
    this.assertReplaceable();
    const result = await this.client.fork(entryId);
    return { cancelled: result.cancelled, selectedText: result.text };
  }

  async inspectLive(_options?: { detail?: "summary" | "full" }): Promise<PiLiveInspectSnapshot> {
    this.assertAvailable();
    void _options;
    throw new Error("inspectLive is not available on the RPC PI host");
  }

  continueTurn(): PiTurnHandle {
    this.assertAvailable();
    throw new Error("continueTurn is not available on the RPC PI host");
  }

  async navigateTree(
    _entryId: string,
    _options?: { summarize?: boolean; label?: string },
  ): Promise<PiNavigateTreeResult> {
    this.assertReplaceable();
    throw new Error("navigateTree is not available on the RPC PI host");
  }

  async prepareBranchSummary(): Promise<import("@pi-3.14/model").PiPreparedBranchSummary> {
    this.assertAvailable();
    throw new Error("prepareBranchSummary is not available on the RPC PI host");
  }

  async getPreparedBranchSummary(): Promise<import("@pi-3.14/model").PiPreparedBranchSummary | null> {
    this.assertAvailable();
    return null;
  }

  async clearPreparedBranchSummary(): Promise<void> {
    this.assertAvailable();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) {
      await this.client.abort().catch(() => {});
      await this.finish(this.active, "aborted");
    }
    await this.client.stop();
  }

  private async settleIfIdle(active: ActiveRpcTurn): Promise<void> {
    if (active.settled || active.settling) return;
    active.settling = true;
    try {
      // PI 0.80.3 lacks a universal agent_settled event. Recheck state after
      // agent_end so retries and queued continuations can claim the run first.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const state = await this.client.getState();
      const pending = numberField(state, "pendingMessageCount");
      if (state.isStreaming || pending > 0) return;
      const reason =
        active.lastStopReason === "stop" ||
        active.lastStopReason === "length" ||
        active.lastStopReason === "aborted" ||
        active.lastStopReason === "error"
          ? active.lastStopReason
          : "error";
      await this.finish(
        active,
        reason,
        reason === "error" && !active.lastStopReason
          ? "PI RPC turn ended without a terminal assistant message"
          : undefined,
        state,
      );
    } catch (error) {
      await this.finish(active, "error", errorMessage(error));
    } finally {
      active.settling = false;
    }
  }

  private async finish(
    active: ActiveRpcTurn,
    reason: PiTurnResult["stopReason"],
    error?: string,
    knownState?: RpcSessionState,
  ): Promise<void> {
    if (active.settled) return;
    active.settled = true;
    clearTimeout(active.timeout);
    if (active.processCheck) clearInterval(active.processCheck);
    active.unsubscribe();
    if (this.active === active) this.active = undefined;

    let state = knownState;
    let text = active.lastText;
    let leafEntryId: string | null = null;
    try {
      state ??= await this.client.getState();
      text ||= (await this.client.getLastAssistantText()) ?? "";
      leafEntryId = (await this.client.getEntries()).leafId;
    } catch (readError) {
      error ??= errorMessage(readError);
      reason = "error";
    }
    active.events.close();
    active.resolve({
      stopReason: reason,
      text,
      sessionId: state?.sessionId ?? "",
      sessionPath: state?.sessionFile ?? null,
      leafEntryId,
      ...(reason === "error" ? { errorMessage: error ?? "PI RPC turn failed" } : {}),
    });
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("PI host is disposed");
  }

  private async abortTimedOutTurn(active: ActiveRpcTurn): Promise<void> {
    await this.client.abort().catch(() => {});
    await this.finish(active, "error", "PI RPC turn timed out");
  }

  private assertReplaceable(): void {
    this.assertAvailable();
    if (this.active) throw new Error("Cannot replace a PI session while a turn is running");
  }
}

export async function createRpcPiHost(options: RpcPiHostOptions = {}): Promise<RpcPiHost> {
  const { turnTimeoutMs, processCheckIntervalMs, ...clientOptions } = options;
  const client = new RpcClient({
    cliPath: join(getPackageDir(), "dist", "cli.js"),
    ...clientOptions,
  });
  await client.start();
  return new RpcPiHost(client, turnTimeoutMs, processCheckIntervalMs);
}

function projectState(state: RpcSessionState): PiHostState {
  const model = state.model as { provider?: unknown; id?: unknown } | null;
  return {
    sessionId: state.sessionId,
    sessionPath: state.sessionFile ?? null,
    // RPC state snapshot does not expose the live leaf; callers that need it
    // should use getEntries() / navigate results instead.
    leafEntryId: null,
    isStreaming: state.isStreaming,
    isCompacting: state.isCompacting,
    model:
      model && typeof model.provider === "string" && typeof model.id === "string"
        ? { provider: model.provider, id: model.id }
        : null,
    thinkingLevel: state.thinkingLevel as PiThinkingLevel,
  };
}

function numberField(value: object, key: string): number {
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" ? field : 0;
}

function messageRole(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const role = (value as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}

function errorMessage(error: unknown): string {
  // Lazy import path avoided — keep rpc free of circulars; local format is enough.
  return formatRpcError(error);
}

function formatRpcError(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message];
    let cause: unknown = (error as Error & { cause?: unknown }).cause;
    let depth = 0;
    while (cause instanceof Error && depth < 4) {
      if (cause.message && !parts.includes(cause.message)) parts.push(cause.message);
      cause = (cause as Error & { cause?: unknown }).cause;
      depth += 1;
    }
    return parts.join("\n");
  }
  return String(error);
}
