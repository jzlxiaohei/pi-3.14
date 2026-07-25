import type { SkillPolicy, TaskPlaybookId } from "./desktop-contracts";
import { catalogTemplateIdForStep } from "./playbook-catalog";

/** Stable system Agent Template ids for playbook steps. */
export type SystemTemplateId =
  | "tpl:feature-default/grilling"
  | "tpl:feature-default/to-spec"
  | "tpl:feature-default/implement"
  | "tpl:small-tdd/tdd"
  | "tpl:small-tdd/code-review"
  | "tpl:bugfix/diagnosing-bugs"
  | "tpl:bugfix/tdd"
  | "tpl:bugfix/code-review";

export type SystemTemplateSeed = {
  id: SystemTemplateId;
  name: string;
  systemPrompt: string;
  skillPolicy: SkillPolicy;
};

const EMPTY_SKILLS: SkillPolicy = { ignoredSkillNames: [] };

/**
 * System Agent Template Role Prompt seeds (ADR-0004 / ADR-0005).
 *
 * Design: thin playbook boundary only — methodology lives in Matt skills
 * (starter `/grill-with-docs`, `/to-spec`, …). Do not paraphrase skill bodies here.
 *
 * - Empty Role Prompt → full PI default coding base at bind.
 * - Non-empty → replaces PI base (keep short: identity + in/out of scope).
 * - Do not embed questionnaire protocol text.
 */
export const SYSTEM_TEMPLATE_SEEDS: SystemTemplateSeed[] = [
  {
    id: "tpl:feature-default/grilling",
    name: "grill-with-docs",
    systemPrompt: [
      "You are the requirements-discovery step of a feature playbook.",
      "",
      "Stay in discovery and alignment. Prefer questions and written decisions over code.",
      "Do not implement the feature or open large patches in this step.",
      "When the problem is sharp enough for a specification step, say so and stop expanding scope.",
    ].join("\n"),
    skillPolicy: EMPTY_SKILLS,
  },
  {
    id: "tpl:feature-default/to-spec",
    name: "to-spec",
    systemPrompt: [
      "You are the specification step of a feature playbook.",
      "",
      "Turn prior decisions into a concise, implementable spec for someone who was not in the discovery chat.",
      "Do not reopen product discovery or invent requirements without a hard blocker.",
      "Do not implement the feature in this step.",
    ].join("\n"),
    skillPolicy: EMPTY_SKILLS,
  },
  {
    id: "tpl:feature-default/implement",
    name: "implement",
    // Empty → PI default coding base; step method via `/implement` skill + starter.
    systemPrompt: "",
    skillPolicy: EMPTY_SKILLS,
  },
  {
    id: "tpl:small-tdd/tdd",
    name: "tdd",
    // Empty → PI default; red-green-refactor via `/tdd` skill + starter.
    systemPrompt: "",
    skillPolicy: EMPTY_SKILLS,
  },
  {
    id: "tpl:small-tdd/code-review",
    name: "code-review",
    systemPrompt: [
      "You are reviewing the recent change set in this playbook step.",
      "",
      "Produce structured, evidence-based findings (severity, where, why it matters, suggestion).",
      "Do not rewrite the feature unless the user asks or a fix is trivial and clearly correct.",
      "Do not nitpick style that tooling already enforces.",
    ].join("\n"),
    skillPolicy: EMPTY_SKILLS,
  },
  {
    id: "tpl:bugfix/diagnosing-bugs",
    name: "diagnosing-bugs",
    systemPrompt: [
      "You are the diagnosis step of a bugfix playbook.",
      "",
      "Find root cause with evidence (repro, logs, code paths). Prefer a clear diagnosis for a following fix step over a speculative large rewrite.",
      "Do not ship a full fix unless the user explicitly wants a one-shot fix.",
    ].join("\n"),
    skillPolicy: EMPTY_SKILLS,
  },
  {
    id: "tpl:bugfix/tdd",
    name: "tdd (fix)",
    // Empty → PI default; fix loop via `/tdd` skill + starter.
    systemPrompt: "",
    skillPolicy: EMPTY_SKILLS,
  },
  {
    id: "tpl:bugfix/code-review",
    name: "code-review (fix)",
    systemPrompt: [
      "You are reviewing a bug-fix change in this playbook step.",
      "",
      "Check fix completeness, regressions, and whether tests guard the root cause—not only a symptom.",
      "Do not re-diagnose from scratch unless the fix looks wrong.",
      "Do not demand large refactors beyond the fix unless residual risk is high.",
    ].join("\n"),
    skillPolicy: EMPTY_SKILLS,
  },
];

/**
 * Catalog default template id for a playbook step.
 * Prefer `step.templateId` on Task.workflow for instance binding (ensure path).
 */
export function templateIdForPlaybookStep(
  playbookId: TaskPlaybookId | string,
  stepId: string,
): SystemTemplateId | null {
  const id = catalogTemplateIdForStep(playbookId, stepId);
  return id as SystemTemplateId | null;
}
