import type { TimelineUserMessage } from "../core";

type UserMessageProps = {
  item: TimelineUserMessage;
};

export function UserMessage(props: UserMessageProps) {
  return (
    <article class="at-message at-message--user" aria-label="Your message">
      <div class="at-user-bubble">{props.item.text}</div>
    </article>
  );
}
