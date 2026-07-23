import { Brain, ChevronDown, ChevronRight, LoaderCircle } from "lucide-solid";
import { Show, createSignal } from "solid-js";
import type { TimelineAssistantMessage } from "../core";
import { MarkdownView } from "./markdown/MarkdownView";

type AssistantMessageProps = {
  item: TimelineAssistantMessage;
  streaming?: boolean;
};

export function AssistantMessage(props: AssistantMessageProps) {
  /** null = follow defaults (open while streaming / before answer). */
  const [userOpen, setUserOpen] = createSignal<boolean | null>(null);

  const hasThinking = () => Boolean(props.item.thinking?.trim());
  const hasText = () => props.item.text.trim().length > 0;
  const thinkingOpen = () => {
    const manual = userOpen();
    if (manual !== null) return manual;
    // Live: show reasoning. After an answer lands, collapse by default.
    return Boolean(props.streaming) || !hasText();
  };

  return (
    <article class="at-message at-message--assistant" aria-label="PI response">
      <div class="at-message-body">
        <Show when={hasThinking()}>
          <div class="at-thinking" data-open={thinkingOpen() ? "true" : "false"}>
            <button
              type="button"
              class="at-thinking__toggle"
              aria-expanded={thinkingOpen()}
              onClick={() => setUserOpen(!thinkingOpen())}
            >
              <Brain size={14} />
              <span>{props.streaming && !hasText() ? "Thinking…" : "Thinking"}</span>
              {thinkingOpen() ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <Show when={thinkingOpen()}>
              <div class="at-thinking__body">
                <pre class="at-thinking__text">{props.item.thinking}</pre>
                <Show when={props.streaming && !hasText()}>
                  <span class="at-caret" aria-label="Streaming thinking" />
                </Show>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={hasText()}>
          <MarkdownView content={props.item.text} streaming={props.streaming} />
        </Show>
        <Show when={props.streaming && !hasText() && !hasThinking()}>
          <p class="at-muted">
            <LoaderCircle class="at-spin" size={14} /> Waiting for model…
          </p>
        </Show>
        <Show when={props.streaming && hasText()}>
          <span class="at-caret" aria-label="Streaming response" />
        </Show>
      </div>
    </article>
  );
}
