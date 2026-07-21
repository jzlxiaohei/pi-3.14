import { Check, Copy, GitBranch } from "lucide-solid";
import type { TaskSummary } from "../model";
import { Button } from "@/shared/ui/button";

type TaskHeaderProps = {
  isComplete: boolean;
  task: TaskSummary;
};

export function TaskHeader(props: TaskHeaderProps) {
  return (
    <header class="task-header">
      <div>
        <div class="title-row">
          <span class="task-state"><span /> {props.isComplete ? "Complete" : "Working"}</span>
          <h1>{props.task.title}</h1>
        </div>
        <p>
          <GitBranch size={14} /> {props.task.repo} <span>•</span> main
        </p>
      </div>
      <div class="header-actions">
        <Button variant="secondary"><Copy size={15} /> Share</Button>
        <Button variant="primary"><Check size={16} strokeWidth={2.4} /> Review changes</Button>
      </div>
    </header>
  );
}
