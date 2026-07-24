import { AlertCircle, Brain, ChevronDown, ChevronRight, LoaderCircle } from "lucide-solid";
import { Show, createMemo, createSignal } from "solid-js";
import type { TimelineAssistantMessage } from "../core";
import { parseQuestionnaire } from "../core/questionnaire";
import { MarkdownView } from "./markdown/MarkdownView";
import { QuestionnaireReply } from "./QuestionnaireReply";

type AssistantMessageProps = {
  item: TimelineAssistantMessage;
  streaming?: boolean;
  /** Latest timeline item — keep thinking open after the turn commits (avoids end-of-turn jump). */
  isLatest?: boolean;
  onPrefillAnswers?: (text: string) => void;
};

export function AssistantMessage(props: AssistantMessageProps) {
  /** null = follow defaults (open while streaming / before answer). */
  const [userOpen, setUserOpen] = createSignal<boolean | null>(null);

  const hasThinking = () => Boolean(props.item.thinking?.trim());
  const hasText = () => props.item.text.trim().length > 0;
  const failure = () => {
    if (props.item.errorMessage?.trim()) return props.item.errorMessage.trim();
    if (props.item.stopReason === "error") return "Model request failed";
    if (props.item.stopReason === "aborted") return "Turn aborted";
    return null;
  };
  const questionnaire = createMemo(() =>
    props.streaming ? null : parseQuestionnaire(props.item.text),
  );
  const thinkingOpen = () => {
    const manual = userOpen();
    if (manual !== null) return manual;
    if (!hasThinking()) return false;
    // Live / thinking-only: open. Latest finished answer: stay open (collapse caused a layout jump
    // when overlay committed to JSONL). Older turns: collapsed by default.
    if (props.streaming || !hasText()) return true;
    return Boolean(props.isLatest);
  };

  return (
    <article
      class="at-message at-message--assistant"
      classList={{ "at-message--failed": Boolean(failure()) }}
      aria-label={failure() ? "PI response failed" : "PI response"}
      data-timeline-entry-id={props.item.id}
    >
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
                <MarkdownView
                  content={props.item.thinking ?? ""}
                  streaming={Boolean(props.streaming && !hasText())}
                />
                <Show when={props.streaming && !hasText()}>
                  <span class="at-caret" aria-label="Streaming thinking" />
                </Show>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={hasText()}>
          <Show
            when={questionnaire()}
            fallback={<MarkdownView content={props.item.text} streaming={props.streaming} />}
          >
            {(form) => (
              <>
                <Show when={form().intro}>
                  <MarkdownView content={form().intro} />
                </Show>
                <QuestionnaireReply
                  id={props.item.id}
                  questionnaire={form()}
                  onPrefillAnswers={props.onPrefillAnswers}
                />
              </>
            )}
          </Show>
        </Show>
        <Show when={failure()}>
          {(message) => (
            <div class="at-message-error" role="alert">
              <AlertCircle size={15} />
              <div>
                <strong>Request failed</strong>
                <p>{message()}</p>
              </div>
            </div>
          )}
        </Show>
        <Show when={props.streaming && !hasText() && !hasThinking() && !failure()}>
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
