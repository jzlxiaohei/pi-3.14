import {
  AlertCircle,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  LoaderCircle,
} from "lucide-solid";
import { Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { writeClipboardText } from "@/shared/clipboard";
import type { TimelineAssistantMessage } from "../core";
import { classifyTimelineError } from "../core/classify-error";
import { viewAssistantQuestionnaire } from "../core/questionnaire";
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
  const failure = createMemo(() => {
    if (props.item.stopReason === "aborted" && !props.item.errorMessage?.trim()) {
      return { title: "Turn aborted", detail: "Turn aborted", kind: "unknown" as const };
    }
    if (props.item.errorMessage?.trim() || props.item.stopReason === "error") {
      return classifyTimelineError(
        props.item.errorMessage?.trim() || "Model request failed",
      );
    }
    return null;
  });

  const questionnaireView = createMemo(() =>
    viewAssistantQuestionnaire(props.item.text, { streaming: Boolean(props.streaming) }),
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
      aria-label={failure() ? failure()!.title : "PI response"}
      data-timeline-entry-id={props.item.id}
      data-error-kind={failure()?.kind}
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
          <Switch>
            <Match when={questionnaireView().phase === "ready" ? questionnaireView() : null}>
              {(ready) => {
                const view = () =>
                  ready() as Extract<ReturnType<typeof questionnaireView>, { phase: "ready" }>;
                return (
                  <>
                    <Show when={view().intro}>
                      <MarkdownView content={view().intro} />
                    </Show>
                    <QuestionnaireReply
                      id={props.item.id}
                      questionnaire={view().questionnaire}
                      onPrefillAnswers={props.onPrefillAnswers}
                    />
                    <Show when={view().outro}>
                      <MarkdownView content={view().outro} />
                    </Show>
                  </>
                );
              }}
            </Match>
            <Match when={questionnaireView().phase === "building" ? questionnaireView() : null}>
              {(building) => {
                const view = () =>
                  building() as Extract<ReturnType<typeof questionnaireView>, { phase: "building" }>;
                return (
                  <>
                    <Show when={view().intro}>
                      <MarkdownView content={view().intro} streaming={props.streaming} />
                    </Show>
                    <div class="at-questionnaire-pending" aria-live="polite" aria-busy="true">
                      <span class="at-questionnaire-pending__icon">
                        <ClipboardList size={17} />
                      </span>
                      <div class="at-questionnaire-pending__body">
                        <strong>正在整理问卷…</strong>
                        <span>选项生成中，完整后会显示可点击的表单（不会展示原始 JSON）。</span>
                      </div>
                      <LoaderCircle class="at-spin" size={16} aria-hidden="true" />
                    </div>
                  </>
                );
              }}
            </Match>
            <Match when={questionnaireView().phase === "broken" ? questionnaireView() : null}>
              {(broken) => {
                const view = () =>
                  broken() as Extract<ReturnType<typeof questionnaireView>, { phase: "broken" }>;
                return (
                  <>
                    <Show when={view().intro}>
                      <MarkdownView content={view().intro} />
                    </Show>
                    <BrokenQuestionnairePanel
                      error={view().error}
                      raw={view().raw}
                      fullText={view().fullText}
                    />
                  </>
                );
              }}
            </Match>
            <Match when={questionnaireView().phase === "plain" ? questionnaireView() : null}>
              {(plain) => (
                <MarkdownView
                  content={
                    (plain() as Extract<ReturnType<typeof questionnaireView>, { phase: "plain" }>).text
                  }
                  streaming={props.streaming}
                />
              )}
            </Match>
          </Switch>
        </Show>
        <Show when={failure()}>
          {(err) => (
            <div class="at-message-error" role="alert" data-kind={err().kind}>
              <AlertCircle size={15} />
              <div class="at-message-error__body">
                <strong>{err().title}</strong>
                <p class="at-message-error__detail">{err().detail}</p>
              </div>
            </div>
          )}
        </Show>
        <Show when={props.streaming && !hasText() && !hasThinking() && !failure()}>
          <p class="at-muted">
            <LoaderCircle class="at-spin" size={14} /> Waiting for model…
          </p>
        </Show>
        <Show
          when={
            props.streaming &&
            hasText() &&
            questionnaireView().phase === "plain"
          }
        >
          <span class="at-caret" aria-label="Streaming response" />
        </Show>
      </div>
    </article>
  );
}

function BrokenQuestionnairePanel(props: {
  error: string;
  raw: string;
  fullText: string;
}) {
  const [open, setOpen] = createSignal(true);
  const [copied, setCopied] = createSignal<"raw" | "full" | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(which: "raw" | "full"): Promise<void> {
    const text = which === "raw" ? props.raw : props.fullText;
    const ok = await writeClipboardText(text);
    if (!ok) return;
    setCopied(which);
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setCopied(null), 1200);
  }

  return (
    <div class="at-questionnaire-pending at-questionnaire-pending--broken" role="alert">
      <span class="at-questionnaire-pending__icon">
        <AlertCircle size={17} />
      </span>
      <div class="at-questionnaire-pending__body">
        <strong>问卷无法展示</strong>
        <span>{props.error}</span>
        <span class="at-questionnaire-pending__hint">
          下方可展开查看原始内容并复制，便于排查或贴回对话让模型重发。
        </span>
        <div class="at-questionnaire-broken__actions">
          <button
            type="button"
            class="at-questionnaire-broken__btn"
            onClick={() => setOpen((value) => !value)}
          >
            {open() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            {open() ? "收起原始内容" : "展开原始内容"}
          </button>
          <button
            type="button"
            class="at-questionnaire-broken__btn"
            onClick={() => void copy("raw")}
          >
            {copied() === "raw" ? <Check size={13} /> : <Copy size={13} />}
            {copied() === "raw" ? "已复制信封" : "复制信封"}
          </button>
          <button
            type="button"
            class="at-questionnaire-broken__btn"
            onClick={() => void copy("full")}
          >
            {copied() === "full" ? <Check size={13} /> : <Copy size={13} />}
            {copied() === "full" ? "已复制全文" : "复制全文"}
          </button>
        </div>
        <Show when={open()}>
          <pre class="at-questionnaire-broken__raw" tabindex={0}>
            {props.raw}
          </pre>
        </Show>
      </div>
    </div>
  );
}
