import { UserCircle } from "lucide-solid";
import type { TimelineUserMessage } from "../core";

type UserMessageProps = {
  item: TimelineUserMessage;
};

export function UserMessage(props: UserMessageProps) {
  return (
    <article class="at-message at-message--user">
      <header class="at-message-meta">
        <span class="at-avatar at-avatar--user"><UserCircle size={21} /></span>
        <strong>You</strong>
        <time>{formatTime(props.item.timestamp)}</time>
      </header>
      <div class="at-user-bubble">{props.item.text}</div>
    </article>
  );
}

function formatTime(value: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(value);
}
