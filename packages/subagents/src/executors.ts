import type { PiHost } from "@pi-3.14/runtime";
import {
  createEmbeddedPiHost,
  createRpcPiHost,
  type EmbeddedPiHostOptions,
  type RpcPiHostOptions,
} from "@pi-3.14/runtime";
import type { SubagentExecution, SubagentExecutor, SubagentInput } from "./types.js";

export type SubagentHostFactory = (input: SubagentInput) => Promise<PiHost>;

export interface InProcessSubagentExecutorOptions {
  host?: Omit<EmbeddedPiHostOptions, "cwd">;
  createHost?: SubagentHostFactory;
}

export interface ProcessSubagentExecutorOptions {
  host?: Omit<RpcPiHostOptions, "cwd">;
  createHost?: SubagentHostFactory;
}

class HostSubagentExecutor implements SubagentExecutor {
  constructor(
    readonly kind: string,
    private readonly createHost: SubagentHostFactory,
  ) {}

  async start(input: SubagentInput): Promise<SubagentExecution> {
    const host = await this.createHost(input);
    try {
      const turn = host.prompt(input.prompt);
      return {
        events: turn.events,
        result: turn.result,
        abort: () => host.abort(),
        dispose: () => host.dispose(),
      };
    } catch (error) {
      await host.dispose().catch(() => {});
      throw error;
    }
  }
}

export function createInProcessSubagentExecutor(
  options: InProcessSubagentExecutorOptions = {},
): SubagentExecutor {
  const createHost =
    options.createHost ??
    ((input: SubagentInput) =>
      createEmbeddedPiHost({
        ...options.host,
        ...(input.cwd ? { cwd: input.cwd } : {}),
      }));
  return new HostSubagentExecutor("in-process", createHost);
}

export function createProcessSubagentExecutor(
  options: ProcessSubagentExecutorOptions = {},
): SubagentExecutor {
  const createHost =
    options.createHost ??
    ((input: SubagentInput) =>
      createRpcPiHost({
        ...options.host,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(input.timeoutMs ? { turnTimeoutMs: input.timeoutMs } : {}),
      }));
  return new HostSubagentExecutor("process", createHost);
}
