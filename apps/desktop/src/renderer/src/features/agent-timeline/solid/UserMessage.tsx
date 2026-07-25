import { Pencil, RotateCw } from "lucide-solid";
import { Show, createSignal } from "solid-js";
import type { TimelineUserMessage } from "../core";
import { Button } from "@/shared/ui/button";
import { IconButton } from "@/shared/ui/icon-button";

export type UserEditOptions = {
  summarizeAbandoned?: boolean;
};

type UserMessageProps = {
  item: TimelineUserMessage;
  /** True when this is the latest user message on the active path. */
  isLatestUser?: boolean;
  /** Latest user has no assistant/tool after it — retry without forking. */
  canRetry?: boolean;
  canEdit?: boolean;
  onEdit?: (
    entryId: string,
    text: string,
    isLatest: boolean,
    options?: UserEditOptions,
  ) => void;
  onRetry?: (entryId: string) => void;
};

export function UserMessage(props: UserMessageProps) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal(props.item.text);
  const [summarizeAbandoned, setSummarizeAbandoned] = createSignal(false);

  const canSummarizeLeave = () => Boolean(props.canEdit && !props.canRetry);

  function startEdit(): void {
    setDraft(props.item.text);
    setSummarizeAbandoned(false);
    setEditing(true);
  }

  function cancel(): void {
    setEditing(false);
    setDraft(props.item.text);
    setSummarizeAbandoned(false);
  }

  function submit(): void {
    const text = draft().trim();
    if (!text || !props.onEdit) return;
    props.onEdit(props.item.id, text, Boolean(props.isLatestUser), {
      summarizeAbandoned: canSummarizeLeave() ? summarizeAbandoned() : false,
    });
    setEditing(false);
    setSummarizeAbandoned(false);
  }

  return (
    <article
      class="at-message at-message--user"
      aria-label="Your message"
      data-timeline-entry-id={props.item.id}
    >
      <Show
        when={editing()}
        fallback={
          <div class="at-user-bubble-wrap">
            <div class="at-user-bubble">{props.item.text}</div>
            <div class="at-user-actions">
              <Show when={props.canRetry && props.onRetry}>
                <IconButton
                  label="Retry (same prompt, no branch)"
                  size="sm"
                  class="at-user-edit at-user-edit--always"
                  onClick={() => props.onRetry?.(props.item.id)}
                >
                  <RotateCw size={13} />
                </IconButton>
              </Show>
              <Show when={props.canEdit && props.onEdit}>
                <IconButton
                  label={
                    props.canRetry
                      ? "Edit & rewrite"
                      : props.isLatestUser
                        ? "Edit & resend"
                        : "Edit & branch"
                  }
                  size="sm"
                  class="at-user-edit"
                  onClick={startEdit}
                >
                  <Pencil size={13} />
                </IconButton>
              </Show>
            </div>
          </div>
        }
      >
        <div class="at-user-edit-form">
          <textarea
            class="at-user-edit-input"
            rows={3}
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
          />
          <div class="at-user-edit-actions">
            <Show when={canSummarizeLeave()}>
              <label class="at-user-edit-summary">
                <input
                  type="checkbox"
                  checked={summarizeAbandoned()}
                  onInput={(event) =>
                    setSummarizeAbandoned(event.currentTarget.checked)
                  }
                />
                <span>生成下方内容摘要并带入新路径</span>
              </label>
            </Show>
            <div class="at-user-edit-actions__buttons">
              <Button variant="secondary" onClick={cancel}>
                Cancel
              </Button>
              <Button variant="primary" onClick={submit} disabled={!draft().trim()}>
                {props.canRetry
                  ? draft().trim() === props.item.text.trim()
                    ? "Retry"
                    : "Rewrite & send"
                  : props.isLatestUser
                    ? "Edit & resend"
                    : "Branch & resend"}
              </Button>
            </div>
          </div>
        </div>
      </Show>
    </article>
  );
}
