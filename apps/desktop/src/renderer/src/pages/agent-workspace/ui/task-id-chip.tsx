import { Check, Copy } from "lucide-solid";
import { createSignal } from "solid-js";

type TaskIdChipProps = {
  id: string;
};

/** Short task id + one-click copy of the full id. */
export function TaskIdChip(props: TaskIdChipProps) {
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(props.id);
    setCopied(true);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <span class="task-id-chip" classList={{ "task-id-chip--copied": copied() }}>
      <code class="task-id" onClick={(event) => void copy(event)}>
        {shortTaskId(props.id)}
      </code>
      <button
        type="button"
        class="task-id-chip__copy"
        aria-label={copied() ? "Copied" : "Copy task id"}
        title={copied() ? "Copied" : "Copy id"}
        onClick={(event) => void copy(event)}
      >
        {copied() ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  );
}

function shortTaskId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}
