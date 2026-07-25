import { Check, ChevronDown, ChevronUp, LayoutTemplate, Route, SkipForward } from "lucide-solid";
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { AgentTemplate, TaskWorkflow } from "../../../../../shared/desktop-contracts";
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
  /** Open Templates library focused on a template id. */
  onOpenTemplate?: (templateId: string) => void;
};

/**
 * Playbook progress card: current step + template provenance.
 * Path structure / step→template mapping is edited on a Playbook definition surface
 * (not here). Role Prompt is edited on the Agent, not re-bound from this card.
 */
export function WorkflowSteps(props: WorkflowStepsProps) {
  const [expanded, setExpanded] = createSignal(true);
  const [phase, setPhase] = createSignal<"enter" | "shown" | "leave">("enter");
  const [stepPulse, setStepPulse] = createSignal(false);
  const [templates, setTemplates] = createSignal<AgentTemplate[]>([]);
  const view = createMemo(() => workflowView(props.workflow));
  const templateId = createMemo(() => view().stepTemplateId);
  const templateName = createMemo(() => {
    const id = templateId();
    if (!id) return null;
    return templates().find((t) => t.id === id)?.name ?? id;
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
            <Show when={templateId()}>
              {(id) => (
                <p class="workflow-steps__provenance">
                  <LayoutTemplate size={12} />
                  <span>来自模板</span>
                  <button
                    type="button"
                    class="workflow-steps__provenance-link"
                    disabled={!props.onOpenTemplate}
                    onClick={() => props.onOpenTemplate?.(id())}
                    title={id()}
                  >
                    {templateName() ?? id()}
                  </button>
                </p>
              )}
            </Show>
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
