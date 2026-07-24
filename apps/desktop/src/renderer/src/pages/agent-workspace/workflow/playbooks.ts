import type {
  TaskPlaybookId,
  TaskWorkflow,
  TaskWorkflowStep,
} from "../../../../../shared/desktop-contracts";

export type PlaybookStepDef = {
  id: string;
  label: string;
  blurb: string;
  /**
   * Role / system instructions for this step’s subagent session
   * (appended via appendSystemPrompt — not the user-visible first message).
   */
  rolePrompt: string;
  /** Prefill for the composer when the step becomes active. */
  starterPrompt: string;
};

export type PlaybookDef = {
  id: TaskPlaybookId;
  title: string;
  description: string;
  steps: PlaybookStepDef[];
};

/** Prefill after one-click project install — user sends; do not auto-run. */
export const SETUP_MATT_SKILLS_PROMPT =
  "/setup-matt-pocock-skills\n\n请按步骤帮我配置本仓库的 engineering skills（issue tracker / triage / domain docs）。";

/**
 * Starters assume Matt engineering skills exist in the workspace (project-local
 * preferred; not vendored into PIE). Slash names match `mattpocock/skills`
 * engineering set (e.g. `/grill-with-docs`).
 */
export const PLAYBOOKS: PlaybookDef[] = [
  {
    id: "feature-default",
    title: "普通功能，细节未清",
    description: "grill-with-docs → to-spec → implement",
    steps: [
      {
        id: "grilling",
        label: "grill-with-docs",
        blurb: "把需求和边界问清楚，再往下走。",
        rolePrompt: [
          "You are in the **grilling / discovery** step of a feature playbook.",
          "Goals: clarify requirements, constraints, open questions, and success criteria.",
          "Prefer questions and short structured notes over large code changes.",
          "Do not implement the full feature in this step; stop when the problem is well-scoped.",
          "Use project domain docs and skills when relevant (e.g. grill-with-docs).",
        ].join("\n"),
        starterPrompt:
          "/grill-with-docs\n\n帮我把这个功能的需求、约束和未决问题问清楚。",
      },
      {
        id: "to-spec",
        label: "to-spec",
        blurb: "把结论收成可执行规格，不再扩需求。",
        rolePrompt: [
          "You are in the **to-spec** step of a feature playbook.",
          "Goals: produce a concise, executable specification from prior decisions.",
          "Do not reopen product discovery or invent new requirements unless a hard blocker appears.",
          "Prefer concrete interfaces, acceptance checks, and file-level plan over vague goals.",
          "Use to-spec skill conventions when available.",
        ].join("\n"),
        starterPrompt: "/to-spec\n\n根据以上讨论起草可执行规格；不要重新发散需求。",
      },
      {
        id: "implement",
        label: "implement",
        blurb: "按已定规格实现，不在实现阶段重开需求。",
        rolePrompt: [
          "You are in the **implement** step of a feature playbook.",
          "Goals: implement against the agreed spec; keep diffs focused and verifiable.",
          "Do not re-litigate requirements; if the spec is incomplete, state the gap briefly and propose a minimal default.",
          "Run checks that fit the repo; leave a short summary of what changed and how to verify.",
        ].join("\n"),
        starterPrompt: "/implement\n\n按已定规格实现；实现阶段不要重新讨论需求。",
      },
    ],
  },
  {
    id: "small-tdd",
    title: "小任务，路径清楚",
    description: "tdd → code-review",
    steps: [
      {
        id: "tdd",
        label: "tdd",
        blurb: "小步 red-green-refactor，对准稳定接口。",
        rolePrompt: [
          "You are in the **TDD** step.",
          "Work in small red → green → refactor loops against a clear interface.",
          "Prefer one failing test at a time; avoid broad refactors unrelated to the task.",
        ].join("\n"),
        starterPrompt: "/tdd\n\n按 TDD 完成这个小改动：一次一个 red-green-refactor 循环。",
      },
      {
        id: "code-review",
        label: "code-review",
        blurb: "对照改动做审查，抓回归与遗漏。",
        rolePrompt: [
          "You are in the **code-review** step.",
          "Review the recent change for correctness, regressions, missing tests, and risk.",
          "Prefer a structured findings list; only patch if the user asks or a fix is trivial and clear.",
        ].join("\n"),
        starterPrompt: "/code-review\n\n审查刚才的改动，指出风险与遗漏。",
      },
    ],
  },
  {
    id: "bugfix",
    title: "Bug 修复",
    description: "diagnosing-bugs → tdd → code-review",
    steps: [
      {
        id: "diagnosing-bugs",
        label: "diagnosing-bugs",
        blurb: "先定位根因，再改代码。",
        rolePrompt: [
          "You are in the **diagnosing-bugs** step.",
          "Find root cause with evidence (repro, logs, code paths). Prefer not to ship a full fix yet.",
          "Summarize the diagnosis clearly for the next TDD step.",
        ].join("\n"),
        starterPrompt: "/diagnosing-bugs\n\n帮我定位这个 bug 的根因，先别急着改。",
      },
      {
        id: "tdd",
        label: "tdd",
        blurb: "用失败测试锁根因，再修到绿灯。",
        rolePrompt: [
          "You are in the **TDD fix** step after diagnosis.",
          "Lock the bug with a failing test, then fix to green with minimal scope.",
        ].join("\n"),
        starterPrompt: "/tdd\n\n针对已定位的根因补测试并修复，走完 red-green-refactor。",
      },
      {
        id: "code-review",
        label: "code-review",
        blurb: "确认修复完整且无副作用。",
        rolePrompt: [
          "You are in the **code-review** step after a bugfix.",
          "Check fix completeness, regressions, and whether the test really guards the root cause.",
        ].join("\n"),
        starterPrompt: "/code-review\n\n审查这次 bug 修复是否完整、有无回归风险。",
      },
    ],
  },
];

export function getPlaybook(id: TaskPlaybookId): PlaybookDef {
  const found = PLAYBOOKS.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown playbook: ${id}`);
  return found;
}

export function getStepDef(
  playbookId: TaskPlaybookId,
  stepId: string,
): PlaybookStepDef | null {
  return getPlaybook(playbookId).steps.find((step) => step.id === stepId) ?? null;
}

export function createWorkflow(playbookId: TaskPlaybookId): TaskWorkflow {
  const playbook = getPlaybook(playbookId);
  const steps: TaskWorkflowStep[] = playbook.steps.map((step, index) => ({
    id: step.id,
    status: index === 0 ? "active" : "pending",
    // First step role is active immediately; taskId filled when root is known.
    ...(index === 0 ? { rolePrompt: step.rolePrompt } : {}),
  }));
  return {
    playbookId,
    stepId: steps[0]!.id,
    steps,
  };
}

export function workflowView(workflow: TaskWorkflow) {
  const playbook = getPlaybook(workflow.playbookId);
  const index = Math.max(
    0,
    playbook.steps.findIndex((step) => step.id === workflow.stepId),
  );
  const def = playbook.steps[index] ?? playbook.steps[0]!;
  const activeStatus = workflow.steps.find((step) => step.id === def.id)?.status;
  const completed =
    workflow.steps.length > 0 &&
    workflow.steps.every((step) => step.status === "done" || step.status === "skipped");
  return {
    playbook,
    stepDef: def,
    stepIndex: index,
    stepCount: playbook.steps.length,
    completed,
    isLast: index >= playbook.steps.length - 1,
    activeStatus,
  };
}

export function advanceWorkflow(
  workflow: TaskWorkflow,
  mode: "done" | "skipped",
): { workflow: TaskWorkflow; starterPrompt: string | null; nextStepDef: PlaybookStepDef | null } {
  const playbook = getPlaybook(workflow.playbookId);
  const index = playbook.steps.findIndex((step) => step.id === workflow.stepId);
  if (index < 0) return { workflow, starterPrompt: null, nextStepDef: null };

  const steps = workflow.steps.map((step) =>
    step.id === workflow.stepId ? { ...step, status: mode } : step,
  );

  const nextIndex = index + 1;
  if (nextIndex >= playbook.steps.length) {
    return {
      workflow: {
        ...workflow,
        stepId: workflow.stepId,
        steps,
      },
      starterPrompt: null,
      nextStepDef: null,
    };
  }

  const next = playbook.steps[nextIndex]!;
  const nextSteps = steps.map((step) =>
    step.id === next.id
      ? { ...step, status: "active" as const, rolePrompt: next.rolePrompt }
      : step,
  );
  return {
    workflow: {
      playbookId: workflow.playbookId,
      stepId: next.id,
      steps: nextSteps,
    },
    starterPrompt: next.starterPrompt,
    nextStepDef: next,
  };
}

/** Compose handoff context + step starter for a new step session. */
export function buildStepOpenPrompt(
  step: PlaybookStepDef,
  handoff?: string | null,
): string {
  const handoffBlock = handoff?.trim()
    ? `## Handoff from previous step\n\n${handoff.trim()}\n\n---\n\n`
    : "";
  return `${handoffBlock}${step.starterPrompt}`;
}
