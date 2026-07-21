import type {
  PiHostEvent,
  PiHostState,
  PiStopReason,
  PiTurnResult,
} from "@pi-3.14/model";
import {
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionFromServicesOptions,
  type CreateAgentSessionRuntimeFactory,
  type CreateAgentSessionServicesOptions,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
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

export interface EmbeddedPiHostOptions {
  cwd?: string;
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
}

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

  constructor(readonly runtime: AgentSessionRuntime) {}

  get session(): AgentSession {
    return this.runtime.session;
  }

  prompt(input: PiPromptInput | string): PiTurnHandle {
    this.assertAvailable();
    if (this.active) throw new Error("A PI turn is already running");

    const events = new AsyncQueue<PiHostEvent>();
    const session = this.session;
    let lastText = "";
    let streamText = "";
    let latestNonEmptyText = "";
    let lastStopReason: PiStopReason | undefined;
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

    const result = this.runPrompt(session, promptText(input), active, events, () => ({
      text: lastText,
      stopReason: lastStopReason,
    }));
    return { events, result };
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
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      model: session.model ? { provider: session.model.provider, id: session.model.id } : null,
      thinkingLevel: session.thinkingLevel,
    };
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

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.unsubscribe();
    this.active = undefined;
    await this.runtime.session.abort().catch(() => {});
    await this.runtime.dispose();
  }

  private async runPrompt(
    session: AgentSession,
    text: string,
    active: ActiveTurn,
    events: AsyncQueue<PiHostEvent>,
    readObserved: () => { text: string; stopReason?: PiStopReason },
  ): Promise<PiTurnResult> {
    let thrown: unknown;
    try {
      await session.prompt(text);
    } catch (error) {
      thrown = error;
    } finally {
      active.unsubscribe();
      if (this.active === active) this.active = undefined;
    }

    const observed = readObserved();
    const fallback = lastAssistant(session);
    const reason = terminalReason(observed.stopReason ?? fallback.stopReason, thrown);
    const result: PiTurnResult = {
      stopReason: reason,
      text: observed.text || fallback.text,
      sessionId: session.sessionId,
      sessionPath: session.sessionFile ?? null,
      leafEntryId: session.sessionManager.getLeafId(),
      ...(reason === "error"
        ? {
            errorMessage:
              errorMessage(thrown) ?? session.agent.state.errorMessage ?? "PI turn failed",
          }
        : {}),
    };
    events.close();
    return result;
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
  const createRuntime: CreateAgentSessionRuntimeFactory =
    options.createRuntime ??
    (async ({ cwd: runtimeCwd, agentDir: runtimeAgentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        ...options.services,
        cwd: runtimeCwd,
        agentDir: runtimeAgentDir,
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
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: options.sessionManager ?? SessionManager.create(cwd),
  });
  return new EmbeddedPiHost(runtime);
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

function errorMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  return error instanceof Error ? error.message : String(error);
}
