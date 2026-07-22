import { ArrowRight, Code2, FolderOpen, Square } from "lucide-solid";
import { Show, createEffect } from "solid-js";
import { IconButton } from "@/shared/ui/icon-button";

const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 200;

type ComposerProps = {
  disabled?: boolean;
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
  let textareaRef: HTMLTextAreaElement | undefined;

  function autoGrow() {
    const el = textareaRef;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT)}px`;
  }

  // Grow/shrink when the value changes from any source (typing, send-clear, suggestions).
  createEffect(() => {
    props.value;
    autoGrow();
  });

  function submit() {
    if (!canSend()) return;
    props.onSubmit();
  }

  return (
    <div class="at-composer-wrap">
      <div class="at-composer">
        <textarea
          ref={textareaRef}
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
              disabled={props.disabled}
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
                <IconButton
                  label="Send message"
                  size="sm"
                  variant="primary"
                  disabled={!canSend()}
                  onClick={submit}
                >
                  <ArrowRight size={18} strokeWidth={2.4} />
                </IconButton>
              }
            >
              <IconButton label="Abort turn" size="sm" variant="danger" onClick={props.onAbort}>
                <Square size={13} fill="currentColor" />
              </IconButton>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
