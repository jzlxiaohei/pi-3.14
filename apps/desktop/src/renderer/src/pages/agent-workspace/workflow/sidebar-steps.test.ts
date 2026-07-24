import assert from "node:assert/strict";
import test from "node:test";
import type { TaskWorkflow } from "../../../../../shared/desktop-contracts";
import { workflowSidebarSteps } from "./sidebar-steps";

const ROOT = "root-1";
const CHILD_SPEC = "child-spec";
const CHILD_IMPL = "child-impl";

function featureWorkflow(overrides?: Partial<TaskWorkflow>): TaskWorkflow {
  return {
    playbookId: "feature-default",
    stepId: "grilling",
    steps: [
      { id: "grilling", status: "active", taskId: ROOT },
      { id: "to-spec", status: "pending" },
      { id: "implement", status: "pending" },
    ],
    ...overrides,
  };
}

test("no workflow → empty rows", () => {
  assert.deepEqual(workflowSidebarSteps(null, ROOT), []);
  assert.deepEqual(workflowSidebarSteps(undefined, ROOT), []);
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
      taskId: row.taskId,
    })),
    [
      {
        stepId: "grilling",
        label: "grill-with-docs",
        clickable: true,
        checked: false,
        open: true,
        taskId: ROOT,
      },
      {
        stepId: "to-spec",
        label: "to-spec",
        clickable: false,
        checked: false,
        open: false,
        taskId: undefined,
      },
      {
        stepId: "implement",
        label: "implement",
        clickable: false,
        checked: false,
        open: false,
        taskId: undefined,
      },
    ],
  );
});

test("later step with taskId is clickable; without is not", () => {
  const workflow = featureWorkflow({
    stepId: "to-spec",
    steps: [
      { id: "grilling", status: "done", taskId: ROOT },
      { id: "to-spec", status: "active", taskId: CHILD_SPEC },
      { id: "implement", status: "pending" },
    ],
  });
  const rows = workflowSidebarSteps(workflow, CHILD_SPEC);
  assert.equal(rows[0]!.clickable, true);
  assert.equal(rows[0]!.checked, true);
  assert.equal(rows[0]!.open, false);
  assert.equal(rows[1]!.clickable, true);
  assert.equal(rows[1]!.taskId, CHILD_SPEC);
  assert.equal(rows[1]!.open, true);
  assert.equal(rows[1]!.checked, false);
  assert.equal(rows[2]!.clickable, false);
  assert.equal(rows[2]!.open, false);
});

test("done and skipped are checked; pending and active are not", () => {
  const workflow = featureWorkflow({
    stepId: "implement",
    steps: [
      { id: "grilling", status: "done", taskId: ROOT },
      { id: "to-spec", status: "skipped", taskId: CHILD_SPEC },
      { id: "implement", status: "active", taskId: CHILD_IMPL },
    ],
  });
  const rows = workflowSidebarSteps(workflow, CHILD_IMPL);
  assert.equal(rows[0]!.checked, true);
  assert.equal(rows[1]!.checked, true);
  assert.equal(rows[2]!.checked, false);
});

test("open follows activeTaskId even when workflow.stepId points elsewhere", () => {
  const workflow = featureWorkflow({
    stepId: "implement",
    steps: [
      { id: "grilling", status: "done", taskId: ROOT },
      { id: "to-spec", status: "done", taskId: CHILD_SPEC },
      { id: "implement", status: "active", taskId: CHILD_IMPL },
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
      { id: "grilling", status: "active", taskId: ROOT },
      { id: "to-spec", status: "pending" },
    ],
  });
  const ids = workflowSidebarSteps(workflow, ROOT).map((row) => row.stepId);
  assert.deepEqual(ids, ["grilling", "to-spec", "implement"]);
});
