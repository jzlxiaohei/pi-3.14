import { CheckCircle, LoaderCircle, PanelRight, ShieldAlert, Wrench, XCircle } from "lucide-solid";
import { Index, Match, Show, Switch, createEffect, createSignal } from "solid-js";
import type { TimelineToolCall } from "../core";
import { ToolCallDetail } from "./ToolCallBlock";
import { ToolFloatPanel } from "./tool-float-panel";

type ToolCallGroupProps = {
  /** Stable view entry id (`tool-group-<firstToolCallId>`). */
  groupId: string;
  tools: TimelineToolCall[];
  active?: boolean;
  pendingApprovalToolCallId?: string | null;
  onAllowApproval?: () => void;
  onDenyApproval?: () => void;
};

/** One-line tool group in the message list; full tool details open in a side float. */
export function ToolCallGroup(props: ToolCallGroupProps) {
  const [open, setOpen] = createSignal(false);
  let anchorRef: HTMLButtonElement | undefined;
  const errorCount = () => props.tools.filter((tool) => tool.status === "error").length;
  const runningCount = () => props.tools.filter((tool) => tool.status === "running").length;
  const pending = () =>
    props.pendingApprovalToolCallId != null &&
    props.tools.some((tool) => tool.toolCallId === props.pendingApprovalToolCallId);

  createEffect(() => {
    if (pending()) setOpen(true);
  });

  const title = () => {
    if (pending()) {
      const tool = props.tools.find((item) => item.toolCallId === props.pendingApprovalToolCallId);
      return tool ? `Allow ${tool.toolName}?` : "Tool approval";
    }
    const n = props.tools.length;
    return n === 1
      ? (props.tools[0]?.summary ?? "Tool call")
      : `${n} tool calls`;
  };

  return (
    <div
      class="at-tool-group"
      data-open={open() ? "true" : "false"}
      data-status={
        pending() ? "approval" : runningCount() > 0 ? "running" : errorCount() > 0 ? "error" : "success"
      }
    >
      <button
        ref={anchorRef}
        type="button"
        class="at-tool-row-trigger"
        aria-expanded={open()}
        aria-label={open() ? "关闭工具详情" : "查看工具详情"}
        onClick={() => setOpen(!open())}
      >
        <span class="at-tool-icon">
          <Show when={pending()} fallback={<Wrench size={15} />}>
            <ShieldAlert size={15} />
          </Show>
        </span>
        <span class="at-tool-copy">
          <strong>
            <Show
              when={pending()}
              fallback={
                <>
                  {props.tools.length} tool {props.tools.length === 1 ? "call" : "calls"}
                  <span class="at-tool-preview"> · {previewLabels(props.tools)}</span>
                  <Show when={errorCount() > 0}>
                    <span class="at-tool-fail-count"> · {errorCount()} failed</span>
                  </Show>
                </>
              }
            >
              Allow{" "}
              {props.tools.find((tool) => tool.toolCallId === props.pendingApprovalToolCallId)
                ?.toolName ?? "tool"}
              ?
            </Show>
          </strong>
        </span>
        <span class="at-tool-state">
          <Switch>
            <Match when={pending()}>
              <ShieldAlert size={16} />
            </Match>
            <Match when={runningCount() > 0}>
              <LoaderCircle class="at-spin" size={16} />
            </Match>
            <Match when={errorCount() > 0}>
              <XCircle size={16} />
            </Match>
            <Match when={errorCount() === 0}>
              <CheckCircle size={16} />
            </Match>
          </Switch>
          <span class="at-tool-open-hint" aria-hidden="true" title="查看详情">
            <PanelRight size={14} />
          </span>
        </span>
      </button>

      <ToolFloatPanel
        open={open()}
        title={title()}
        getAnchor={() => anchorRef}
        onOpenChange={setOpen}
      >
        <div class="at-tool-popover__list">
          <Index each={props.tools}>
            {(tool, index) => {
              const alone = () => props.tools.length === 1;
              const isPending = () => props.pendingApprovalToolCallId === tool().toolCallId;
              const defaultOpen = () => alone() || isPending();
              return (
                <ToolCallDetail
                  index={index + 1}
                  defaultOpen={defaultOpen()}
                  item={tool()}
                  pendingApproval={isPending()}
                  onAllow={props.onAllowApproval}
                  onDeny={props.onDenyApproval}
                />
              );
            }}
          </Index>
        </div>
      </ToolFloatPanel>
    </div>
  );
}

function previewLabels(tools: TimelineToolCall[]): string {
  const names = tools.map((tool) => tool.toolName);
  const unique = [...new Set(names)];
  if (unique.length <= 3) return unique.join(" · ");
  return `${unique.slice(0, 3).join(" · ")} +${unique.length - 3}`;
}
