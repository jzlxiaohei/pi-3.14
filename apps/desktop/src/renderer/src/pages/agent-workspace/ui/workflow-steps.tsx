import { Check, ChevronDown, ChevronUp, Route, SkipForward, X } from "lucide-solid";
import { Show, createMemo, createSignal } from "solid-js";
import type { TaskWorkflow } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";
import { advanceWorkflow, workflowView } from "../workflow/playbooks";

type WorkflowStepsProps = {
  disabled?: boolean;
  workflow: TaskWorkflow;
  onWorkflowChange: (workflow: TaskWorkflow | null, starterPrompt: string | null) => void;
};

/** Right-floating step card — only when a playbook is attached. */
export function WorkflowSteps(props: WorkflowStepsProps) {
  const [expanded, setExpanded] = createSignal(true);
  const view = createMemo(() => workflowView(props.workflow));

  function advance(mode: "done" | "skipped") {
    const result = advanceWorkflow(props.workflow, mode);
    props.onWorkflowChange(result.workflow, result.starterPrompt);
  }

  function clear() {
    props.onWorkflowChange(null, null);
  }

  return (
    <div class="workflow-steps" data-expanded={expanded() ? "true" : "false"}>
      <Show
        when={expanded()}
        fallback={
          <button
            type="button"
            class="workflow-steps__pill"
            disabled={props.disabled}
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
        }
      >
        <div class="workflow-steps__card">
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
                disabled={props.disabled}
                onClick={() => setExpanded(false)}
              >
                <ChevronDown size={14} />
              </IconButton>
              <IconButton
                label="Remove engineering path"
                size="sm"
                disabled={props.disabled}
                onClick={clear}
              >
                <X size={14} />
              </IconButton>
            </div>
          </div>
          <p class="workflow-steps__step">{view().stepDef.label}</p>
          <p class="workflow-steps__blurb">{view().stepDef.blurb}</p>
          <div class="workflow-steps__actions">
            <Show
              when={!view().completed}
              fallback={
                <Button variant="secondary" disabled={props.disabled} onClick={clear}>
                  <Check size={14} />
                  清除路径
                </Button>
              }
            >
              <Button
                variant="secondary"
                disabled={props.disabled}
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
                    disabled={props.disabled}
                    onClick={() => advance("done")}
                  >
                    Next
                  </Button>
                }
              >
                <Button
                  variant="primary"
                  disabled={props.disabled}
                  onClick={() => advance("done")}
                >
                  <Check size={14} />
                  Done
                </Button>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}
