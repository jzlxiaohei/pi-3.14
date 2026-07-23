import { ArrowRight, Code2, FolderOpen, Square } from "lucide-solid";
import type { JSX } from "solid-js";
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { IconButton } from "@/shared/ui/icon-button";
import { Select, type SelectOption } from "@/shared/ui/select";

const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 200;

type ComposerProps = {
  /** Increment when draft is programmatically prefilled — triggers attention motion. */
  attentionKey?: number;
  disabled?: boolean;
  modelLabel: string;
  modelOptions: SelectOption[];
  modelValue: string | null;
  onAbort: () => void;
  onInput: (value: string) => void;
  onModelChange: (value: string) => void;
  onSelectWorkspace: () => void;
  onSubmit: () => void;
  onThinkingChange: (value: string) => void;
  streaming?: boolean;
  thinkingLevel: string;
  thinkingOptions: SelectOption[];
  thinkingValue: string | null;
  toolbarAction?: JSX.Element;
  value: string;
  workspaceLabel: string;
  workspaceTitle?: string;
};

export function Composer(props: ComposerProps) {
  const canSend = () => !props.disabled && !props.streaming && props.value.trim().length > 0;
  const [attention, setAttention] = createSignal(false);
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

  createEffect(() => {
    const key = props.attentionKey ?? 0;
    if (key <= 0) return;

    setAttention(true);
    queueMicrotask(() => {
      const el = textareaRef;
      if (!el || el.disabled) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    const timer = window.setTimeout(() => setAttention(false), 320);
    onCleanup(() => {
      window.clearTimeout(timer);
      setAttention(false);
    });
  });

  function submit() {
    if (!canSend()) return;
    props.onSubmit();
  }

  return (
    <div class="at-composer-wrap">
      <div class="at-composer" data-attention={attention() ? "true" : undefined}>
        <textarea
          ref={textareaRef}
          value={props.value}
          disabled={props.disabled || props.streaming}
          onInput={(event) => props.onInput(event.currentTarget.value)}
          onKeyDown={(event) => {
            // Chat convention: Enter sends, Shift+Enter inserts a newline.
            if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
            event.preventDefault();
            submit();
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
            <Show
              when={props.thinkingOptions.length > 0}
              fallback={
                <span class="at-context-pill at-context-pill--static">
                  <Code2 size={14} /> {props.thinkingLevel}
                </span>
              }
            >
              <Select
                class="at-composer-select"
                disabled={props.disabled || props.streaming}
                options={props.thinkingOptions}
                placeholder="thinking"
                value={props.thinkingValue}
                onValueChange={props.onThinkingChange}
              />
            </Show>
          </div>
          <div>
            {props.toolbarAction}
            <Show
              when={props.modelOptions.length > 0}
              fallback={<span class="at-model-pill">{props.modelLabel}</span>}
            >
              <Select
                class="at-composer-select at-composer-select--model"
                disabled={props.disabled || props.streaming}
                options={props.modelOptions}
                placeholder="model"
                value={props.modelValue}
                onValueChange={props.onModelChange}
              />
            </Show>
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
                  <ArrowRight size={15} />
                </IconButton>
              }
            >
              <IconButton label="Stop generation" size="sm" variant="danger" onClick={props.onAbort}>
                <Square size={13} fill="currentColor" />
              </IconButton>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
