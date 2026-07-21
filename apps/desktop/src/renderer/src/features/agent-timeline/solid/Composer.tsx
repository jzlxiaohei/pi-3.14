import { ArrowRight, Code2, FolderOpen, LoaderCircle, Square } from "lucide-solid";
import { Show } from "solid-js";

type ComposerProps = {
  disabled?: boolean;
  errorMessage?: string | null;
  modelLabel: string;
  onAbort: () => void;
  onInput: (value: string) => void;
  onSelectWorkspace: () => void;
  onSubmit: () => void;
  streaming?: boolean;
  thinkingLevel: string;
  value: string;
  workspaceLabel: string;
  workspaceTitle?: string;
};

export function Composer(props: ComposerProps) {
  const canSend = () => !props.disabled && !props.streaming && props.value.trim().length > 0;

  function submit() {
    if (!canSend()) return;
    props.onSubmit();
  }

  return (
    <div class="at-composer-wrap">
      <div class="at-composer">
        <textarea
          value={props.value}
          disabled={props.disabled || props.streaming}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          }}
          placeholder="Ask PI to change, explain, inspect, or verify this workspace..."
        />
        <div class="at-composer-toolbar">
          <div>
            <button
              class="at-context-pill"
              type="button"
              title={props.workspaceTitle ?? props.workspaceLabel}
              onClick={props.onSelectWorkspace}
            >
              <FolderOpen size={14} /> {props.workspaceLabel}
            </button>
            <span class="at-context-pill at-context-pill--static">
              <Code2 size={14} /> {props.thinkingLevel}
            </span>
          </div>
          <div>
            <span class="at-model-pill">{props.modelLabel}</span>
            <Show
              when={props.streaming}
              fallback={
                <button class="at-send-button" disabled={!canSend()} aria-label="Send message" onClick={submit}>
                  <ArrowRight size={18} strokeWidth={2.4} />
                </button>
              }
            >
              <button class="at-abort-button" aria-label="Abort turn" onClick={props.onAbort}>
                <Square size={13} fill="currentColor" />
              </button>
            </Show>
          </div>
        </div>
      </div>
      <p
        class="at-composer-hint"
        classList={{ "at-composer-hint--error": Boolean(props.errorMessage) && !props.streaming }}
      >
        <Show when={props.streaming}>
          <LoaderCircle class="at-spin" size={12} /> Working…
        </Show>
        <Show when={!props.streaming && props.errorMessage}>
          {props.errorMessage}
        </Show>
        <Show when={!props.streaming && !props.errorMessage}>
          PI can edit files and run tools. Review changes before merging.
        </Show>
      </p>
    </div>
  );
}
