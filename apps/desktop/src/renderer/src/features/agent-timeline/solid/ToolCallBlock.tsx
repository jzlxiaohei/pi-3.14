import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileCode,
  LoaderCircle,
  Search,
  ShieldAlert,
  Terminal,
  XCircle,
} from "lucide-solid";
import { For, Match, Show, Switch, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import type { TimelineToolCall } from "../core";
import { formatJson } from "../core";
import { CodeBlock } from "./markdown/CodeBlock";

type ToolCallBlockProps = {
  item: TimelineToolCall;
  pendingApproval?: boolean;
  onAllow?: () => void;
  onDeny?: () => void;
};

export function ToolCallBlock(props: ToolCallBlockProps) {
  const [open, setOpen] = createSignal(false);
  const hasDetails = () => Boolean(props.item.output || props.item.diff);

  return (
    <article
      class="at-tool-call"
      data-status={props.pendingApproval ? "approval" : props.item.status}
    >
      <div class="at-tool-main">
        <span class="at-tool-icon">{toolIcon(props.item.toolName)}</span>
        <span class="at-tool-copy">
          <strong>{props.pendingApproval ? `Allow ${props.item.toolName}?` : props.item.summary}</strong>
          <small>{props.item.detail}</small>
        </span>
        <span class="at-tool-state">
          <Show when={props.pendingApproval} fallback={stateIcon(props.item.status)}>
            <ShieldAlert size={17} />
          </Show>
        </span>
      </div>

      <Show when={props.pendingApproval}>
        <div class="at-tool-approval">
          <p>This tool can modify the workspace. Allow it to continue?</p>
          <div class="at-tool-approval-actions">
            <button type="button" class="at-tool-approval-deny" onClick={() => props.onDeny?.()}>
              Deny
            </button>
            <button type="button" class="at-tool-approval-allow" onClick={() => props.onAllow?.()}>
              Allow
            </button>
          </div>
        </div>
      </Show>

      <details class="at-tool-args">
        <summary>Arguments</summary>
        <CodeBlock code={formatJson(props.item.args)} language="json" />
      </details>

      <Show when={hasDetails()}>
        <button class="at-tool-toggle" type="button" onClick={() => setOpen((value) => !value)}>
          {open() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {props.item.diff ? "Patch" : "Output"}
        </button>
        <Show when={open()}>
          <div class="at-tool-details">
            <Show when={props.item.diff}>
              {(diff) => <DiffPreview diff={diff()} />}
            </Show>
            <Show when={!props.item.diff && props.item.output}>
              {(output) => <CodeBlock code={output()} language="text" />}
            </Show>
          </div>
        </Show>
      </Show>
    </article>
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
      <Match when={status === "running"}><LoaderCircle class="at-spin" size={17} /></Match>
      <Match when={status === "error"}><XCircle size={17} /></Match>
      <Match when={status === "success"}><CheckCircle size={17} /></Match>
    </Switch>
  );
}
