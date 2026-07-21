import { Check, Copy, GitBranch } from "lucide-solid";
import type { TaskSummary } from "../model";
import type { TimelineRunStatus } from "@/features/agent-timeline";
import { Button } from "@/shared/ui/button";

type TaskHeaderProps = {
  branch?: string | null;
  onReviewChanges?: () => void;
  status: TimelineRunStatus;
  task: TaskSummary | null;
};

export function TaskHeader(props: TaskHeaderProps) {
  const meta = () => {
    const branch = props.branch ?? "main";
    const repo = props.task?.repo;
    return repo ? `${branch} · ${repo}` : branch;
  };

  return (
    <header class="task-header">
      <div class="task-header-copy">
        <div class="title-row">
          <span class="task-state"><span /> {statusLabel(props.status)}</span>
          <h1 title={props.task?.title ?? undefined}>{props.task?.title ?? "Start a task"}</h1>
        </div>
        <p class="task-meta" title={props.task?.cwd ?? undefined}>
          <GitBranch size={14} /> {meta()}
        </p>
      </div>
      <div class="header-actions">
        <Button variant="secondary"><Copy size={15} /> Share</Button>
        <Button variant="primary" onClick={() => props.onReviewChanges?.()}>
          <Check size={16} strokeWidth={2.4} /> Review changes
        </Button>
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
