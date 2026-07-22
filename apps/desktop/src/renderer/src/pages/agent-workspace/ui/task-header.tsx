import { Check, Copy, GitBranch, GitCompareArrows, LoaderCircle, Terminal } from "lucide-solid";
import { Show } from "solid-js";
import type { InspectorTab, TaskSummary } from "../model";
import type { TimelineRunStatus } from "@/features/agent-timeline";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";

type TaskHeaderProps = {
  branch?: string | null;
  changeCount?: number;
  inspectorOpen?: boolean;
  inspectorTab?: InspectorTab;
  loading?: boolean;
  onReviewChanges?: () => void;
  onToggleInspector?: (tab: InspectorTab) => void;
  status: TimelineRunStatus;
  task: TaskSummary | null;
};

export function TaskHeader(props: TaskHeaderProps) {
  const meta = () => {
    const branch = props.branch ?? "main";
    const repo = props.task?.repo;
    return repo ? `${branch} · ${repo}` : branch;
  };

  const changesActive = () => props.inspectorOpen && props.inspectorTab === "changes";
  const terminalActive = () => props.inspectorOpen && props.inspectorTab === "terminal";
  const changeCount = () => props.changeCount ?? 0;

  return (
    <header class="task-header">
      <div class="task-header-copy">
        <div class="title-row">
          <span class="task-state" data-loading={props.loading ? "true" : undefined}>
            {props.loading ? <LoaderCircle class="at-spin" size={12} /> : <span />}
            {props.loading ? "Opening" : statusLabel(props.status)}
          </span>
          <h1 title={props.task?.title ?? undefined}>{props.task?.title ?? "Start a task"}</h1>
        </div>
        <p class="task-meta" title={props.task?.cwd ?? undefined}>
          <GitBranch size={14} /> {meta()}
        </p>
      </div>
      <div class="header-actions">
        <IconButton
          label={changesActive() ? "Hide changes" : "Show changes"}
          size="sm"
          active={changesActive()}
          onClick={() => props.onToggleInspector?.("changes")}
        >
          <GitCompareArrows size={16} />
        </IconButton>
        <IconButton
          label={terminalActive() ? "Hide terminal" : "Show terminal"}
          size="sm"
          active={terminalActive()}
          onClick={() => props.onToggleInspector?.("terminal")}
        >
          <Terminal size={16} />
        </IconButton>
        <Button variant="secondary"><Copy size={15} /> Share</Button>
        <Show when={changeCount() > 0}>
          <Button variant="primary" onClick={() => props.onReviewChanges?.()}>
            <Check size={15} strokeWidth={2} /> Review {changeCount()}{" "}
            {changeCount() === 1 ? "change" : "changes"}
          </Button>
        </Show>
      </div>
    </header>
  );
}

function statusLabel(status: TimelineRunStatus): string {
  switch (status) {
    case "streaming":
      return "Working";
    case "compacting":
      return "Compacting";
    case "retrying":
      return "Retrying";
    case "error":
      return "Needs attention";
    case "aborted":
      return "Aborted";
    case "idle":
      return "Ready";
  }
}
