import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileCode,
  LoaderCircle,
  PanelRight,
  Search,
  ShieldAlert,
  Terminal,
  XCircle,
} from "lucide-solid";
import { For, Match, Show, Switch, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { TimelineToolCall } from "../core";
import { formatJson } from "../core";
import { CodeBlock } from "./markdown/CodeBlock";
import { ToolFloatPanel } from "./tool-float-panel";

type ToolCallBlockProps = {
  item: TimelineToolCall;
  pendingApproval?: boolean;
  onAllow?: () => void;
  onDeny?: () => void;
};

type ToolCallDetailProps = ToolCallBlockProps & {
  /** 1-based index within the group. */
  index: number;
  /** When false (multi-call), start collapsed so calls stay distinct. */
  defaultOpen?: boolean;
};

/** One-line tool row in the message list; args/output/approval live in a side float. */
export function ToolCallBlock(props: ToolCallBlockProps) {
  const [open, setOpen] = createSignal(false);
  let anchorRef: HTMLButtonElement | undefined;

  createEffect(() => {
    if (props.pendingApproval) setOpen(true);
  });

  return (
    <article
      class="at-tool-call"
      data-status={props.pendingApproval ? "approval" : props.item.status}
    >
      <button
        ref={anchorRef}
        type="button"
        class="at-tool-row-trigger"
        aria-expanded={open()}
        aria-label={open() ? "关闭工具详情" : "查看工具详情"}
        onClick={() => setOpen(!open())}
      >
        <ToolCallRowTrigger item={props.item} pendingApproval={props.pendingApproval} />
      </button>
      <ToolFloatPanel
        open={open()}
        title={props.pendingApproval ? `Allow ${props.item.toolName}?` : props.item.summary}
        getAnchor={() => anchorRef}
        onOpenChange={setOpen}
      >
        <ToolCallDetail
          index={1}
          defaultOpen
          item={props.item}
          pendingApproval={props.pendingApproval}
          onAllow={props.onAllow}
          onDeny={props.onDeny}
        />
      </ToolFloatPanel>
    </article>
  );
}

/** One tool inside the group float — collapsed by default when there are multiple calls. */
export function ToolCallDetail(props: ToolCallDetailProps) {
  const [expanded, setExpanded] = createSignal(
    Boolean(props.defaultOpen || props.pendingApproval),
  );
  const hasOutput = () => Boolean(props.item.output || props.item.diff);
  const outputLabel = () => (props.item.diff ? "Patch" : "Output");

  createEffect(() => {
    if (props.pendingApproval) setExpanded(true);
  });

  return (
    <section
      class="at-tool-detail"
      data-status={props.pendingApproval ? "approval" : props.item.status}
      data-open={expanded() ? "true" : "false"}
    >
      <button
        type="button"
        class="at-tool-detail__toggle"
        aria-expanded={expanded()}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded(!expanded());
        }}
      >
        <span class="at-tool-detail__index">{props.index}</span>
        <span class="at-tool-icon">{toolIcon(props.item.toolName)}</span>
        <span class="at-tool-copy">
          <strong>
            <span class="at-tool-detail__name">{props.item.toolName}</span>
            <span class="at-tool-preview">
              {" "}
              · {props.pendingApproval ? `Allow?` : props.item.summary}
            </span>
          </strong>
          <Show when={props.item.detail}>
            <small>{props.item.detail}</small>
          </Show>
        </span>
        <span class="at-tool-state">
          <Show when={props.pendingApproval} fallback={stateIcon(props.item.status)}>
            <ShieldAlert size={15} />
          </Show>
          {expanded() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      <Show when={expanded()}>
        <div class="at-tool-detail__body">
          <Show when={props.pendingApproval}>
            <div class="at-tool-approval">
              <p>Allow for this chat? Remaining ask-tier tools will auto-run until you switch back to Ask.</p>
              <div class="at-tool-approval-actions">
                <button
                  type="button"
                  class="at-tool-approval-deny"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onDeny?.();
                  }}
                >
                  Deny
                </button>
                <button
                  type="button"
                  class="at-tool-approval-allow"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onAllow?.();
                  }}
                >
                  Allow for this chat
                </button>
              </div>
            </div>
          </Show>

          <div class="at-tool-detail__section">
            <h4>Arguments</h4>
            <CodeBlock code={formatJson(props.item.args)} language="json" />
          </div>

          <Show when={hasOutput()}>
            <div class="at-tool-detail__section">
              <h4>{outputLabel()}</h4>
              <Show when={props.item.diff}>
                {(diff) => <DiffPreview diff={diff()} />}
              </Show>
              <Show when={!props.item.diff && props.item.output}>
                {(output) => (
                  <div
                    class="at-tool-output"
                    classList={{ "at-tool-output--error": props.item.status === "error" }}
                  >
                    <CodeBlock code={output()} language="text" />
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </section>
  );
}

function ToolCallRowTrigger(props: {
  item: TimelineToolCall;
  pendingApproval?: boolean;
}) {
  return (
    <>
      <span class="at-tool-icon">{toolIcon(props.item.toolName)}</span>
      <span class="at-tool-copy">
        <strong>
          {props.pendingApproval ? `Allow ${props.item.toolName}?` : props.item.summary}
          <Show when={props.item.detail}>
            <span class="at-tool-preview"> · {props.item.detail}</span>
          </Show>
        </strong>
      </span>
      <span class="at-tool-state">
        <Show when={props.pendingApproval} fallback={stateIcon(props.item.status)}>
          <ShieldAlert size={16} />
        </Show>
        <span class="at-tool-open-hint" aria-hidden="true" title="查看详情">
          <PanelRight size={14} />
        </span>
      </span>
    </>
  );
}

function DiffPreview(props: { diff: string }) {
  return (
    <pre class="at-diff-preview">
      <For each={props.diff.split("\n")}>
        {(line) => <span data-kind={diffKind(line)}>{line || " "}</span>}
      </For>
    </pre>
  );
}

function diffKind(line: string): "added" | "context" | "header" | "removed" {
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  if (line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) return "header";
  return "context";
}

function toolIcon(toolName: string): JSX.Element {
  if (/bash|shell|terminal/i.test(toolName)) return <Terminal size={15} />;
  if (/edit|write|patch/i.test(toolName)) return <FileCode size={15} />;
  return <Search size={15} />;
}

function stateIcon(status: TimelineToolCall["status"]): JSX.Element {
  return (
    <Switch>
      <Match when={status === "running"}>
        <LoaderCircle class="at-spin" size={17} />
      </Match>
      <Match when={status === "error"}>
        <XCircle size={17} />
      </Match>
      <Match when={status === "success"}>
        <CheckCircle size={17} />
      </Match>
    </Switch>
  );
}
