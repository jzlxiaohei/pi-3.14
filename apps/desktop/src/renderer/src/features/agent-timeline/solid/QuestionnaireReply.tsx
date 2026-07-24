import { Check, ChevronLeft, ChevronRight, ClipboardList } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Questionnaire } from "../core/questionnaire";
import { MarkdownView } from "./markdown/MarkdownView";

type QuestionnaireReplyProps = {
  id: string;
  questionnaire: Questionnaire;
  onPrefillAnswers?: (text: string) => void;
};

type QuestionResponse = {
  choices?: string[];
  note?: string;
};

export function QuestionnaireReply(props: QuestionnaireReplyProps) {
  const [currentIndex, setCurrentIndex] = createSignal(0);
  const [responses, setResponses] = createSignal<Record<number, QuestionResponse>>({});
  const currentQuestion = () => props.questionnaire.questions[currentIndex()]!;
  const responseFor = (number: number) => responses()[number];
  const hasResponse = (number: number) => {
    const response = responseFor(number);
    return Boolean(response?.choices?.length || response?.note?.trim());
  };
  const answeredCount = createMemo(() =>
    props.questionnaire.questions.filter((question) => hasResponse(question.number)).length,
  );

  createEffect(() => {
    props.id;
    setCurrentIndex(0);
    setResponses({});
  });

  function choose(value: string) {
    const question = currentQuestion();
    const current = responseFor(question.number)?.choices ?? [];
    const choices = question.type === "multi_choice"
      ? current.includes(value)
        ? current.filter((choice) => choice !== value)
        : [...current, value]
      : [value];
    setResponses((previous) => ({
      ...previous,
      [question.number]: { ...previous[question.number], choices },
    }));
    if (
      question.type === "single_choice" &&
      currentIndex() < props.questionnaire.questions.length - 1
    ) {
      setCurrentIndex((index) => index + 1);
    }
  }

  function setNote(value: string) {
    const number = currentQuestion().number;
    setResponses((previous) => ({
      ...previous,
      [number]: { ...previous[number], note: value },
    }));
  }

  function answerText(number: number): string {
    const response = responseFor(number);
    const note = response?.note?.trim();
    const choices = response?.choices?.join("、") ?? "";
    if (choices && note) return `${choices}；补充：${note}`;
    return choices || note || "";
  }

  function prefillAnswers() {
    if (!props.onPrefillAnswers || answeredCount() === 0) return;
    const lines = props.questionnaire.questions.flatMap((question) => {
      const answer = answerText(question.number);
      return answer ? [`${question.number}. ${question.title}`, answer, ""] : [];
    });
    props.onPrefillAnswers(`以下是我的回答：\n\n${lines.join("\n").trim()}`);
  }

  return (
    <section class="at-questionnaire" aria-label={`${props.questionnaire.questions.length} 个待回答问题`}>
      <header class="at-questionnaire__header">
        <span class="at-questionnaire__icon"><ClipboardList size={17} /></span>
        <div class="at-questionnaire__heading">
          <strong>{props.questionnaire.title ?? `需要你回答 ${props.questionnaire.questions.length} 个问题`}</strong>
          <span>点击明确选项会自动进入下一题；有不同要求可补充说明</span>
        </div>
        <span class="at-questionnaire__count">已回答 {answeredCount()}/{props.questionnaire.questions.length}</span>
      </header>

      <div class="at-questionnaire__progress" aria-hidden="true">
        <span style={{ width: `${(answeredCount() / props.questionnaire.questions.length) * 100}%` }} />
      </div>

      <nav class="at-questionnaire__steps" aria-label="问题列表">
        <For each={props.questionnaire.questions}>
          {(question, index) => {
            const answered = () => hasResponse(question.number);
            return (
              <button
                type="button"
                class="at-questionnaire__step"
                classList={{
                  "at-questionnaire__step--active": index() === currentIndex(),
                  "at-questionnaire__step--answered": answered(),
                }}
                aria-label={`问题 ${question.number}：${question.title}${answered() ? "，已回答" : ""}`}
                aria-current={index() === currentIndex() ? "step" : undefined}
                onClick={() => setCurrentIndex(index())}
              >
                <Show when={answered()} fallback={question.number}><Check size={12} /></Show>
              </button>
            );
          }}
        </For>
      </nav>

      <div class="at-questionnaire__question">
        <div class="at-questionnaire__title">
          <span>{currentQuestion().number}</span>
          <h3>{currentQuestion().title}</h3>
        </div>
        <Show when={currentQuestion().markdown}>
          <div class="at-questionnaire__context">
            <MarkdownView content={currentQuestion().markdown} />
          </div>
        </Show>
        <Show when={currentQuestion().options.length > 0}>
          <div
            class="at-questionnaire__options"
            role="group"
            aria-label={currentQuestion().type === "multi_choice" ? "快捷选项，可多选" : "快捷选项"}
          >
            <For each={currentQuestion().options}>
              {(option) => {
                const selected = () =>
                  responseFor(currentQuestion().number)?.choices?.includes(option.value) ?? false;
                return (
                  <button
                    type="button"
                    class="at-questionnaire__option"
                    classList={{ "at-questionnaire__option--selected": selected() }}
                    aria-pressed={selected()}
                    onClick={() => choose(option.value)}
                  >
                    <strong>{option.value}</strong>
                    <span>{option.label}</span>
                    <Show when={selected()} fallback={<ChevronRight size={15} />}>
                      <Check size={15} />
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
        <Show when={currentQuestion().type === "text" || currentQuestion().allowOther}>
          <label class="at-questionnaire__answer">
            <span>
              {currentQuestion().options.length > 0
                ? "有不同要求或需要补充？"
                : "你的回答"}
            </span>
            <textarea
              value={responseFor(currentQuestion().number)?.note ?? ""}
              placeholder={
                currentQuestion().options.length > 0
                  ? "可直接写下不同要求，或补充所选方案…"
                  : "输入你的要求；如果不同于建议，请直接说明…"
              }
              onInput={(event) => setNote(event.currentTarget.value)}
            />
          </label>
        </Show>
      </div>

      <footer class="at-questionnaire__actions">
        <button
          type="button"
          class="at-questionnaire__nav"
          disabled={currentIndex() === 0}
          onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
        >
          <ChevronLeft size={15} /> 上一题
        </button>
        <span>{currentIndex() + 1} / {props.questionnaire.questions.length}</span>
        <Show
          when={currentIndex() === props.questionnaire.questions.length - 1}
          fallback={
            <button
              type="button"
              class="at-questionnaire__nav at-questionnaire__nav--next"
              onClick={() => setCurrentIndex((index) => Math.min(props.questionnaire.questions.length - 1, index + 1))}
            >
              下一题 <ChevronRight size={15} />
            </button>
          }
        >
          <button
            type="button"
            class="at-questionnaire__submit"
            disabled={!props.onPrefillAnswers || answeredCount() === 0}
            onClick={prefillAnswers}
          >
            填入输入框 <ChevronRight size={15} />
          </button>
        </Show>
      </footer>
    </section>
  );
}
