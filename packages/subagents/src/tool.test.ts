import assert from "node:assert/strict";
import test from "node:test";
import type { SubagentOrchestrator } from "./orchestrator.js";
import { createSubagentTool } from "./tool.js";

const orchestrator = {} as SubagentOrchestrator;

test("uses English tool metadata by default", () => {
  const tool = createSubagentTool(orchestrator);

  assert.equal(tool.label, "Run subagent");
  assert.equal(
    tool.description,
    "Start an independent PI subagent for parallel, self-contained work and return its final result.",
  );
});

test("accepts custom tool label and description", () => {
  const tool = createSubagentTool(orchestrator, {
    label: "Delegate work",
    description: "Send an isolated task to a worker.",
  });

  assert.equal(tool.label, "Delegate work");
  assert.equal(tool.description, "Send an isolated task to a worker.");
});
