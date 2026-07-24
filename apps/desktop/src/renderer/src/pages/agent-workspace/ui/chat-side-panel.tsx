import {
  Activity,
  Cpu,
  FolderOpen,
  GitBranch,
  GitCompareArrows,
  Gauge,
  PanelRight,
} from "lucide-solid";
import { For, Show, type JSX } from "solid-js";
import type { TimelineRunStatus } from "@/features/agent-timeline";
import { Button } from "@/shared/ui/button";
import type { TaskStatus } from "../model";

export type ChatSideQuotaWindow = {
  label: string;
  usedPercent: number | null;
  resetAtMs?: number | null;
  windowSeconds?: number | null;
};

type ChatSidePanelProps = {
  /** Optional lead slot (workflow card). */
  lead?: JSX.Element;
  status: TimelineRunStatus;
  taskStatus?: TaskStatus;
  modelLabel?: string | null;
  thinkingLabel?: string | null;
  branch?: string | null;
  workspaceLabel?: string | null;
  changeCount?: number;
  contextPercent?: number | null;
  quotaWindows?: ChatSideQuotaWindow[];
  quotaMessage?: string | null;
  ready?: boolean;
  onReviewChanges?: () => void;
  onOpenInspector?: () => void;
};

/** Light session meta for the surplus chat gutter (hidden when inspector is open). */
export function ChatSidePanel(props: ChatSidePanelProps) {
  const changeCount = () => props.changeCount ?? 0;
  const contextPercent = () =>
    props.contextPercent != null ? Math.round(props.contextPercent) : null;

  return (
    <div class="chat-side-panel">
      <Show when={props.lead != null}>
        <div class="chat-side-panel__lead">{props.lead}</div>
      </Show>

      <section class="chat-side-section" aria-label="Session">
        <header class="chat-side-section__head">
          <Activity size={13} />
          <span>Session</span>
        </header>
        <dl class="chat-side-facts">
          <div>
            <dt>Status</dt>
            <dd>
              <span class="chat-side-status" data-status={props.status}>
                {statusLabel(props.status, props.taskStatus)}
              </span>
            </dd>
          </div>
          <Show when={props.modelLabel}>
            <div>
              <dt>
                <Cpu size={12} /> Model
              </dt>
              <dd title={props.modelLabel ?? undefined}>{props.modelLabel}</dd>
            </div>
          </Show>
          <Show when={props.thinkingLabel}>
            <div>
              <dt>Thinking</dt>
              <dd>{props.thinkingLabel}</dd>
            </div>
          </Show>
        </dl>
      </section>

      <section class="chat-side-section" aria-label="Context and usage">
        <header class="chat-side-section__head">
          <Gauge size={13} />
          <span>Context</span>
        </header>
        <Show
          when={props.ready}
          fallback={<p class="chat-side-empty">Open a session to see context usage.</p>}
        >
          <div class="chat-side-meter">
            <div class="chat-side-meter__row">
              <span>Context window</span>
              <strong>{contextPercent() != null ? `${contextPercent()}%` : "—"}</strong>
            </div>
            <div
              class="chat-side-meter__bar"
              data-alert={isAlert(props.contextPercent) ? "true" : undefined}
            >
              <span style={{ width: `${clampPercent(props.contextPercent)}%` }} />
            </div>
          </div>

          <Show
            when={(props.quotaWindows?.length ?? 0) > 0}
            fallback={
              <p class="chat-side-empty chat-side-empty--soft">
                {props.quotaMessage ?? "Usage windows unavailable"}
              </p>
            }
          >
            <ul class="chat-side-quota">
              <For each={props.quotaWindows ?? []}>
                {(windowRow) => (
                  <li>
                    <div class="chat-side-meter__row">
                      <span>{windowRow.label}</span>
                      <strong>
                        {windowRow.usedPercent != null
                          ? `${Math.round(windowRow.usedPercent)}%`
                          : "—"}
                      </strong>
                    </div>
                    <div
                      class="chat-side-meter__bar"
                      data-alert={isAlert(windowRow.usedPercent) ? "true" : undefined}
                    >
                      <span style={{ width: `${clampPercent(windowRow.usedPercent)}%` }} />
                    </div>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </Show>
      </section>

      <section class="chat-side-section" aria-label="Workspace">
        <header class="chat-side-section__head">
          <FolderOpen size={13} />
          <span>Workspace</span>
        </header>
        <dl class="chat-side-facts">
          <div>
            <dt>
              <GitBranch size={12} /> Branch
            </dt>
            <dd title={props.branch ?? undefined}>{props.branch ?? "—"}</dd>
          </div>
          <div>
            <dt>
              <GitCompareArrows size={12} /> Changes
            </dt>
            <dd>{changeCount() > 0 ? `${changeCount()} file${changeCount() === 1 ? "" : "s"}` : "Clean"}</dd>
          </div>
          <Show when={props.workspaceLabel}>
            <div>
              <dt>Folder</dt>
              <dd class="chat-side-facts__path" title={props.workspaceLabel ?? undefined}>
                {props.workspaceLabel}
              </dd>
            </div>
          </Show>
        </dl>
        <div class="chat-side-actions">
          <Button
            variant="secondary"
            disabled={changeCount() === 0}
            onClick={() => props.onReviewChanges?.()}
          >
            <GitCompareArrows size={14} />
            Review
          </Button>
          <Button variant="secondary" onClick={() => props.onOpenInspector?.()}>
            <PanelRight size={14} />
            Inspector
          </Button>
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: TimelineRunStatus, taskStatus?: TaskStatus): string {
  if (status === "idle" && taskStatus === "interrupted") return "Interrupted";
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

function clampPercent(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function isAlert(value: number | null | undefined): boolean {
  return value != null && value >= 80;
}
