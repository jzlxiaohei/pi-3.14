import { LoaderCircle, Sparkles } from "lucide-solid";
import { Show } from "solid-js";
import type { TimelineAssistantMessage } from "../core";
import { MarkdownView } from "./markdown/MarkdownView";

type AssistantMessageProps = {
  item: TimelineAssistantMessage;
  streaming?: boolean;
};

export function AssistantMessage(props: AssistantMessageProps) {
  return (
    <article class="at-message at-message--assistant">
      <header class="at-message-meta">
        <span class="at-avatar at-avatar--agent"><Sparkles size={17} /></span>
        <strong>PI</strong>
        <span class="at-role">CODE AGENT</span>
        <time>{formatTime(props.item.timestamp)}</time>
      </header>
      <div class="at-message-body">
        <Show when={props.item.text.trim().length > 0}>
          <MarkdownView content={props.item.text} />
        </Show>
        <Show when={props.streaming && props.item.text.trim().length === 0}>
          <p class="at-muted"><LoaderCircle class="at-spin" size={14} /> Thinking...</p>
        </Show>
        <Show when={props.streaming && props.item.text.trim().length > 0}>
          <span class="at-caret" aria-label="Streaming response" />
        </Show>
      </div>
    </article>
  );
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);
}
