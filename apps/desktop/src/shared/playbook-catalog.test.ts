import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkflowFromPlaybook,
  normalizeWorkflowBindings,
  resolveStepTemplateId,
} from "./playbook-catalog";

test("createWorkflowFromPlaybook stamps templateId on every step", () => {
  const workflow = createWorkflowFromPlaybook("feature-default");
  assert.equal(workflow.stepId, "grilling");
  assert.equal(workflow.steps.length, 3);
  assert.equal(workflow.steps[0]!.templateId, "tpl:feature-default/grilling");
  assert.equal(workflow.steps[1]!.templateId, "tpl:feature-default/to-spec");
  assert.equal(workflow.steps[2]!.templateId, "tpl:feature-default/implement");
  assert.ok(workflow.steps[0]!.starterPrompt?.includes("/grill-with-docs"));
});

test("normalizeWorkflowBindings fills legacy steps without overwriting stamps", () => {
  const legacy = normalizeWorkflowBindings({
    playbookId: "feature-default",
    stepId: "grilling",
    steps: [
      { id: "grilling", status: "active" },
      { id: "to-spec", status: "pending", templateId: "tpl:user-override" },
    ],
  });
  assert.equal(legacy.steps[0]!.templateId, "tpl:feature-default/grilling");
  assert.equal(legacy.steps[1]!.templateId, "tpl:user-override");
});

test("resolveStepTemplateId prefers instance stamp", () => {
  const workflow = createWorkflowFromPlaybook("feature-default");
  workflow.steps[0] = {
    ...workflow.steps[0]!,
    templateId: "custom-tpl",
  };
  assert.equal(resolveStepTemplateId(workflow, "grilling"), "custom-tpl");
  assert.equal(resolveStepTemplateId(workflow, "to-spec"), "tpl:feature-default/to-spec");
});
