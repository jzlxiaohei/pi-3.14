import assert from "node:assert/strict";
import test from "node:test";
import type { Agent, TaskWorkflow } from "../../../../../shared/desktop-contracts";
import { agentSidebarRows, taskNestedSidebarRows, workflowSidebarSteps } from "./sidebar-steps";

const ROOT = "root-1";
const CHILD_SPEC = "child-spec";
const CHILD_IMPL = "child-impl";

function featureWorkflow(overrides?: Partial<TaskWorkflow>): TaskWorkflow {
  return {
    playbookId: "feature-default",
    stepId: "grilling",
    steps: [
      { id: "grilling", status: "active", agentId: ROOT },
      { id: "to-spec", status: "pending" },
      { id: "implement", status: "pending" },
    ],
    ...overrides,
  };
}

test("no workflow → empty playbook rows; agents still list", () => {
  assert.deepEqual(workflowSidebarSteps(null, ROOT), []);
  assert.deepEqual(workflowSidebarSteps(undefined, ROOT), []);
  const agents = [
    {
      id: "a1",
      taskId: "t1",
      parentAgentId: null,
      templateId: null,
      name: "grill-with-docs",
      systemPrompt: "",
      skillPolicy: { ignoredSkillNames: [] },
      inputContext: null,
      outputContext: null,
      sessionId: "s1",
      sessionPath: "/tmp/a.jsonl",
      sessionAvailability: "available" as const,
      status: "done" as const,
      rolePromptConfirmedAt: null,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "a2",
      taskId: "t1",
      parentAgentId: null,
      templateId: null,
      name: "to-spec",
      systemPrompt: "",
      skillPolicy: { ignoredSkillNames: [] },
      inputContext: null,
      outputContext: null,
      sessionId: "s2",
      sessionPath: "/tmp/b.jsonl",
      sessionAvailability: "available" as const,
      status: "idle" as const,
      rolePromptConfirmedAt: null,
      position: 1,
      createdAt: 2,
      updatedAt: 2,
    },
  ] satisfies Agent[];
  const rows = agentSidebarRows(agents, "a2");
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.clickable, true);
  assert.equal(rows[0]!.checked, true);
  assert.equal(rows[1]!.open, true);
  assert.equal(taskNestedSidebarRows(null, agents, "a1")[0]!.agentId, "a1");
  assert.equal(taskNestedSidebarRows(featureWorkflow(), agents, ROOT).length, 3);
});

test("only step 1 bound → three rows; only first clickable; open when active is root", () => {
  const rows = workflowSidebarSteps(featureWorkflow(), ROOT);
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => ({
      stepId: row.stepId,
      label: row.label,
      clickable: row.clickable,
      checked: row.checked,
      open: row.open,
      agentId: row.agentId,
    })),
    [
      {
        stepId: "grilling",
        label: "grill-with-docs",
        clickable: true,
        checked: false,
        open: true,
        agentId: ROOT,
      },
      {
        stepId: "to-spec",
        label: "to-spec",
        clickable: false,
        checked: false,
        open: false,
        agentId: undefined,
      },
      {
        stepId: "implement",
        label: "implement",
        clickable: false,
        checked: false,
        open: false,
        agentId: undefined,
      },
    ],
  );
});

test("later step with agentId is clickable; without is not", () => {
  const workflow = featureWorkflow({
    stepId: "to-spec",
    steps: [
      { id: "grilling", status: "done", agentId: ROOT },
      { id: "to-spec", status: "active", agentId: CHILD_SPEC },
      { id: "implement", status: "pending" },
    ],
  });
  const rows = workflowSidebarSteps(workflow, CHILD_SPEC);
  assert.equal(rows[0]!.clickable, true);
  assert.equal(rows[0]!.checked, true);
  assert.equal(rows[0]!.open, false);
  assert.equal(rows[1]!.clickable, true);
  assert.equal(rows[1]!.agentId, CHILD_SPEC);
  assert.equal(rows[1]!.open, true);
  assert.equal(rows[1]!.checked, false);
  assert.equal(rows[2]!.clickable, false);
  assert.equal(rows[2]!.open, false);
});

test("done and skipped are checked; pending and active are not", () => {
  const workflow = featureWorkflow({
    stepId: "implement",
    steps: [
      { id: "grilling", status: "done", agentId: ROOT },
      { id: "to-spec", status: "skipped", agentId: CHILD_SPEC },
      { id: "implement", status: "active", agentId: CHILD_IMPL },
    ],
  });
  const rows = workflowSidebarSteps(workflow, CHILD_IMPL);
  assert.equal(rows[0]!.checked, true);
  assert.equal(rows[1]!.checked, true);
  assert.equal(rows[2]!.checked, false);
});

test("open follows activeAgentId even when workflow.stepId points elsewhere", () => {
  const workflow = featureWorkflow({
    stepId: "implement",
    steps: [
      { id: "grilling", status: "done", agentId: ROOT },
      { id: "to-spec", status: "done", agentId: CHILD_SPEC },
      { id: "implement", status: "active", agentId: CHILD_IMPL },
    ],
  });
  // User resumed grilling while playbook current step is still implement.
  const rows = workflowSidebarSteps(workflow, ROOT);
  assert.equal(rows[0]!.open, true);
  assert.equal(rows[1]!.open, false);
  assert.equal(rows[2]!.open, false);
  assert.equal(rows[2]!.checked, false);
});

test("order follows playbook definition", () => {
  const workflow = featureWorkflow({
    steps: [
      // Deliberately out of playbook order in storage.
      { id: "implement", status: "pending" },
      { id: "grilling", status: "active", agentId: ROOT },
      { id: "to-spec", status: "pending" },
    ],
  });
  const ids = workflowSidebarSteps(workflow, ROOT).map((row) => row.stepId);
  assert.deepEqual(ids, ["grilling", "to-spec", "implement"]);
});
