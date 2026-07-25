import { Check, ChevronDown, ChevronUp, LayoutTemplate, Route, SkipForward } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type {
  AgentTemplate,
  TaskWorkflow,
  TaskWorkflowStep,
} from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";
import { advanceWorkflow, workflowView } from "../workflow/playbooks";

const LEAVE_MS = 180;

type WorkflowStepsProps = {
  disabled?: boolean;
  workflow: TaskWorkflow;
  /** Done → handoff generation in progress. */
  advancing?: boolean;
  /** gutter = reserved side rail; overlay = compact float when gutter is hidden. */
  placement?: "gutter" | "overlay";
  onWorkflowChange: (workflow: TaskWorkflow | null, starterPrompt: string | null) => void;
  /**
   * When set, Done / Skip use this instead of only prefilling the next starter
   * (e.g. spawn next step subagent session).
   */
  onStepAdvance?: (mode: "done" | "skipped") => void;
  /** Open Templates library focused on a template id (discover binding). */
  onOpenTemplate?: (templateId: string) => void;
};

type BindingRow = {
  stepId: string;
  label: string;
  index: number;
  status: TaskWorkflowStep["status"];
  templateId: string;
  agentId?: string;
  isCurrent: boolean;
};

/**
 * Playbook step card. Parent keeps it mounted while `workflow` is set.
 * Collapse only hides chrome; mid-path there is no “remove path” control —
 * only a completed playbook can clear via 清除路径.
 */
export function WorkflowSteps(props: WorkflowStepsProps) {
  const [expanded, setExpanded] = createSignal(true);
  const [phase, setPhase] = createSignal<"enter" | "shown" | "leave">("enter");
  const [stepPulse, setStepPulse] = createSignal(false);
  const [templates, setTemplates] = createSignal<AgentTemplate[]>([]);
  const view = createMemo(() => workflowView(props.workflow));

  /** Full path bindings — not only the active step (active is always agent-bound after create). */
  const bindingRows = createMemo((): BindingRow[] => {
    const playbook = view().playbook;
    const byId = new Map(props.workflow.steps.map((s) => [s.id, s]));
    return playbook.steps.map((def, index) => {
      const bound = byId.get(def.id);
      const templateId = bound?.templateId?.trim() || def.templateId;
      return {
        stepId: def.id,
        label: def.label,
        index,
        status: bound?.status ?? (index === 0 ? "active" : "pending"),
        templateId,
        ...(bound?.agentId ? { agentId: bound.agentId } : {}),
        isCurrent: def.id === props.workflow.stepId,
      };
    });
  });

  onMount(() => {
    void window.piDesktop.templates.list().then(setTemplates).catch(() => setTemplates([]));
  });

  let leaveTimer: number | undefined;
  let enterFrame: number | undefined;
  let pulseTimer: number | undefined;
  let previousStepKey: string | undefined;
  let previousPlaybookId: string | undefined;

  createEffect(() => {
    const playbookId = props.workflow.playbookId;
    if (previousPlaybookId !== undefined && previousPlaybookId !== playbookId) {
      setPhase("enter");
      setExpanded(true);
      cancelAnimationFrame(enterFrame ?? 0);
      enterFrame = requestAnimationFrame(() => {
        enterFrame = requestAnimationFrame(() => setPhase("shown"));
      });
    } else if (previousPlaybookId === undefined) {
      setPhase("enter");
      enterFrame = requestAnimationFrame(() => {
        enterFrame = requestAnimationFrame(() => setPhase("shown"));
      });
    }
    previousPlaybookId = playbookId;
  });

  createEffect(() => {
    const key = `${props.workflow.playbookId}:${props.workflow.stepId}`;
    if (previousStepKey !== undefined && previousStepKey !== key && phase() !== "leave") {
      setStepPulse(true);
      window.clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => setStepPulse(false), LEAVE_MS);
    }
    previousStepKey = key;
  });

  onCleanup(() => {
    window.clearTimeout(leaveTimer);
    window.clearTimeout(pulseTimer);
    cancelAnimationFrame(enterFrame ?? 0);
  });

  function dismiss(next: TaskWorkflow | null, starterPrompt: string | null) {
    if (phase() === "leave") return;
    setPhase("leave");
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      props.onWorkflowChange(next, starterPrompt);
    }, LEAVE_MS);
  }

  function advance(mode: "done" | "skipped") {
    if (phase() === "leave") return;
    if (props.onStepAdvance) {
      props.onStepAdvance(mode);
      return;
    }
    const result = advanceWorkflow(props.workflow, mode);
    const nextWorkflow = workflowView(result.workflow).completed ? null : result.workflow;
    if (nextWorkflow === null) {
      dismiss(null, result.starterPrompt);
      return;
    }
    props.onWorkflowChange(nextWorkflow, result.starterPrompt);
  }

  function clear() {
    dismiss(null, null);
  }

  function templateName(id: string): string {
    return templates().find((t) => t.id === id)?.name ?? id;
  }

  /**
   * Per-task rebind for any step that has no Agent yet.
   * Ensures the step row exists on workflow.steps (legacy shells).
   */
  function rebindStepTemplate(stepId: string, nextTemplateId: string): void {
    if (props.disabled || phase() === "leave") return;
    const id = nextTemplateId.trim();
    if (!id) return;
    const existing = props.workflow.steps.find((s) => s.id === stepId);
    if (existing?.agentId) return;

    const def = view().playbook.steps.find((s) => s.id === stepId);
    let steps = props.workflow.steps.map((step) =>
      step.id === stepId ? { ...step, templateId: id } : step,
    );
    if (!steps.some((s) => s.id === stepId)) {
      steps = [
        ...steps,
        {
          id: stepId,
          status: "pending",
          templateId: id,
          ...(def?.starterPrompt ? { starterPrompt: def.starterPrompt } : {}),
        },
      ];
    }
    props.onWorkflowChange({ ...props.workflow, steps }, null);
  }

  return (
    <div
      class="workflow-steps"
      data-expanded={expanded() ? "true" : "false"}
      data-phase={phase()}
      data-placement={props.placement ?? "gutter"}
      data-step-pulse={stepPulse() ? "true" : "false"}
    >
      <div class="workflow-steps__stack">
        <button
          type="button"
          class="workflow-steps__pill"
          disabled={props.disabled || phase() === "leave"}
          aria-hidden={expanded() ? true : undefined}
          tabindex={expanded() ? -1 : 0}
          onClick={() => setExpanded(true)}
        >
          <Route size={14} />
          <span>
            {view().completed
              ? "Done"
              : `${view().stepIndex + 1}/${view().stepCount}`}
          </span>
          <ChevronUp size={14} />
        </button>

        <div class="workflow-steps__card" aria-hidden={expanded() ? undefined : true}>
          <div class="workflow-steps__head">
            <div class="workflow-steps__title">
              <Route size={14} />
              <span class="workflow-steps__count">
                {view().completed
                  ? "完成"
                  : `${view().stepIndex + 1}/${view().stepCount}`}
              </span>
              <strong>{view().playbook.title}</strong>
            </div>
            <div class="workflow-steps__head-actions">
              <IconButton
                label="Collapse steps"
                size="sm"
                disabled={props.disabled || phase() === "leave"}
                onClick={() => setExpanded(false)}
              >
                <ChevronDown size={14} />
              </IconButton>
            </div>
          </div>
          <div class="workflow-steps__body">
            <p class="workflow-steps__step">{view().stepDef.label}</p>
            <p class="workflow-steps__blurb">{view().stepDef.blurb}</p>

            <div class="workflow-steps__bindings">
              <div class="workflow-steps__bindings-head">
                <LayoutTemplate size={13} />
                <span>步骤 → Agent Template</span>
              </div>
              <ul class="workflow-steps__bindings-list">
                <For each={bindingRows()}>
                  {(row) => {
                    const locked = () => Boolean(row.agentId);
                    return (
                      <li
                        class="workflow-steps__binding"
                        data-current={row.isCurrent ? "true" : undefined}
                        data-locked={locked() ? "true" : undefined}
                      >
                        <div class="workflow-steps__binding-step">
                          <span class="workflow-steps__binding-index">{row.index + 1}</span>
                          <span class="workflow-steps__binding-label">{row.label}</span>
                          <Show when={row.isCurrent}>
                            <span class="workflow-steps__binding-badge">当前</span>
                          </Show>
                          <Show when={locked()}>
                            <span class="workflow-steps__binding-badge workflow-steps__binding-badge--lock">
                              已建 Agent
                            </span>
                          </Show>
                        </div>
                        <Show
                          when={!locked()}
                          fallback={
                            <button
                              type="button"
                              class="workflow-steps__template-link"
                              disabled={!props.onOpenTemplate}
                              onClick={() => props.onOpenTemplate?.(row.templateId)}
                              title={row.templateId}
                            >
                              {templateName(row.templateId)}
                              <span class="workflow-steps__template-id">{row.templateId}</span>
                            </button>
                          }
                        >
                          <select
                            class="workflow-steps__template-select"
                            value={row.templateId}
                            disabled={props.disabled || phase() === "leave"}
                            onChange={(event) =>
                              rebindStepTemplate(row.stepId, event.currentTarget.value)
                            }
                            title="本步尚未创建 Agent，可改绑定；推进到该步时生效"
                          >
                            <For each={templates()}>
                              {(t) => (
                                <option value={t.id}>
                                  {t.source === "system" ? "系统" : "用户"} · {t.name}
                                </option>
                              )}
                            </For>
                            <Show when={!templates().some((t) => t.id === row.templateId)}>
                              <option value={row.templateId}>{row.templateId}</option>
                            </Show>
                          </select>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
              <p class="workflow-steps__bindings-hint">
                未创建 Agent 的步骤可改模板；已创建的步骤绑定锁定（快照隔离）。
              </p>
            </div>

            <Show when={props.advancing}>
              <p class="workflow-steps__advancing" aria-live="polite">
                正在生成步骤交接摘要…
              </p>
            </Show>
            <div class="workflow-steps__actions">
              <Show
                when={!view().completed}
                fallback={
                  <Button
                    variant="secondary"
                    disabled={props.disabled || phase() === "leave"}
                    onClick={clear}
                  >
                    <Check size={14} />
                    清除路径
                  </Button>
                }
              >
                <Button
                  variant="secondary"
                  disabled={props.disabled || phase() === "leave"}
                  onClick={() => advance("skipped")}
                >
                  <SkipForward size={14} />
                  Skip
                </Button>
                <Show
                  when={view().isLast}
                  fallback={
                    <Button
                      variant="primary"
                      disabled={props.disabled || phase() === "leave"}
                      onClick={() => advance("done")}
                    >
                      {props.advancing ? "交接中…" : "Next"}
                    </Button>
                  }
                >
                  <Button
                    variant="primary"
                    disabled={props.disabled || phase() === "leave"}
                    onClick={() => advance("done")}
                  >
                    <Check size={14} />
                    {props.advancing ? "交接中…" : "Done"}
                  </Button>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
