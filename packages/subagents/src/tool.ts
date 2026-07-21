import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SubagentOrchestrator } from "./orchestrator.js";

export interface CreateSubagentToolOptions {
  name?: string;
  label?: string;
  description?: string;
  defaultCwd?: string;
  allowCwd?: boolean;
}

export function createSubagentTool(
  orchestrator: SubagentOrchestrator,
  options: CreateSubagentToolOptions = {},
) {
  const name = options.name ?? "subagent";
  return defineTool({
    name,
    label: options.label ?? "Run subagent",
    description:
      options.description ??
      "Start an independent PI subagent for parallel, self-contained work and return its final result.",
    promptSnippet: `Use ${name} to delegate independent, self-contained work to a PI subagent.`,
    promptGuidelines: [
      "Delegate only well-scoped, self-contained work and include all necessary context in task.",
      "Use multiple tool calls for independent tasks that can run in parallel.",
      "Do not delegate steps that depend on context available only to the parent agent.",
    ],
    executionMode: "parallel",
    parameters: Type.Object({
      task: Type.String({ description: "Complete task and context for the subagent" }),
      cwd: Type.Optional(
        Type.String({ description: "Subagent working directory, when allowed by the host" }),
      ),
    }),
    execute: async (_toolCallId, params, signal) => {
      if (params.cwd && !options.allowCwd) {
        throw new Error("This host does not allow subagents to override cwd");
      }
      const handle = orchestrator.spawn({
        prompt: params.task,
        ...(params.cwd || options.defaultCwd ? { cwd: params.cwd ?? options.defaultCwd } : {}),
      });
      const abort = () => {
        void handle.abort().catch(() => {});
      };
      if (signal?.aborted) abort();
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const result = await handle.result;
        const text =
          result.status === "completed"
            ? result.text
            : `Subagent ${result.status}: ${result.errorMessage ?? (result.text || "no result")}`;
        return {
          content: [{ type: "text" as const, text }],
          details: result,
        };
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
  });
}
