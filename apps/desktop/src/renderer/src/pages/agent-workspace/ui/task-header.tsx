import { Download, GitBranch, GitCompareArrows, LoaderCircle, PanelRight, Route, X } from "lucide-solid";
import { Show, createSignal } from "solid-js";
import type { TimelineRunStatus } from "@/features/agent-timeline";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";
import type { TaskSummary } from "../model";

type TaskHeaderProps = {
  branch?: string | null;
  changeCount?: number;
  inspectorOpen?: boolean;
  loading?: boolean;
  /** Playbook title when this task has an engineering path. */
  playbookTitle?: string | null;
  canExportSession?: boolean;
  onClearPlaybook?: () => void;
  onExportSession?: () => void;
  onReviewChanges?: () => void;
  onToggleInspectorPanel?: () => void;
  status: TimelineRunStatus;
  task: TaskSummary | null;
};

export function TaskHeader(props: TaskHeaderProps) {
  const [metaOpen, setMetaOpen] = createSignal(false);
  const changeCount = () => props.changeCount ?? 0;
  const meta = () => {
    const branch = props.branch ?? "main";
    const repo = props.task?.repo;
    return repo ? `${branch} · ${repo}` : branch;
  };

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
        <div class="task-meta-wrap">
          <button
            type="button"
            class="task-meta"
            disabled={!props.task || props.loading}
            title="Task details"
            onClick={() => setMetaOpen((open) => !open)}
          >
            <GitBranch size={14} /> {meta()}
            <Show when={props.playbookTitle}>
              <span class="task-meta__path">
                <Route size={12} /> {props.playbookTitle}
              </span>
            </Show>
          </button>
          <Show when={metaOpen() && props.task}>
            <div class="task-meta-popover" role="dialog" aria-label="Task details">
              <div class="task-meta-popover__head">
                <strong>Task details</strong>
                <IconButton label="Close" size="sm" onClick={() => setMetaOpen(false)}>
                  <X size={14} />
                </IconButton>
              </div>
              <dl class="task-meta-popover__list">
                <div>
                  <dt>Title</dt>
                  <dd>{props.task!.title}</dd>
                </div>
                <div>
                  <dt>Branch</dt>
                  <dd>{props.branch ?? "—"}</dd>
                </div>
                <div>
                  <dt>Workspace</dt>
                  <dd>
                    <code>{props.task!.cwd}</code>
                  </dd>
                </div>
                <div>
                  <dt>Engineering path</dt>
                  <dd>{props.playbookTitle ?? "None (free chat)"}</dd>
                </div>
              </dl>
              <Show when={props.playbookTitle && props.onClearPlaybook}>
                <Button
                  variant="secondary"
                  onClick={() => {
                    props.onClearPlaybook?.();
                    setMetaOpen(false);
                  }}
                >
                  Clear path
                </Button>
              </Show>
            </div>
          </Show>
        </div>
      </div>
      <div class="header-actions">
        <Button
          variant="secondary"
          disabled={props.loading || !props.canExportSession}
          onClick={() => props.onExportSession?.()}
        >
          <Download size={15} /> 导出 session
        </Button>
        <IconButton
          label={
            changeCount() > 0
              ? `Review ${changeCount()} ${changeCount() === 1 ? "change" : "changes"}`
              : "No changes to review"
          }
          size="sm"
          disabled={props.loading || changeCount() === 0}
          classList={{ "icon-button--has-changes": changeCount() > 0 }}
          onClick={() => props.onReviewChanges?.()}
        >
          <GitCompareArrows size={16} />
          <Show when={changeCount() > 0}>
            <span class="icon-button__badge">{changeCount() > 99 ? "99+" : changeCount()}</span>
          </Show>
        </IconButton>
        <IconButton
          label={props.inspectorOpen ? "Collapse inspector" : "Expand inspector"}
          size="sm"
          active={props.inspectorOpen}
          disabled={props.loading}
          onClick={() => props.onToggleInspectorPanel?.()}
        >
          <PanelRight size={16} />
        </IconButton>
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
