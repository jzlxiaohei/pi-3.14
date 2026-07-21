import { ArrowRight, ChevronDown, Code2, Paperclip } from "lucide-solid";
import { createSignal } from "solid-js";
import { IconButton } from "@/shared/ui/icon-button";

type ComposerProps = {
  onSend: () => void;
};

export function Composer(props: ComposerProps) {
  const [value, setValue] = createSignal("");
  const canSend = () => value().trim().length > 0;

  function submit() {
    if (!canSend()) return;
    props.onSend();
    setValue("");
  }

  return (
    <div class="composer-wrap">
      <div class="composer">
        <textarea
          value={value()}
          onInput={(event) => setValue(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          }}
          placeholder="Ask Orbit to change, explain, or verify anything..."
        />
        <div class="composer-toolbar">
          <div>
            <IconButton label="Attach files">
              <Paperclip size={18} />
            </IconButton>
            <button class="context-pill"><Code2 size={14} /> Add context</button>
          </div>
          <div>
            <button class="model-picker">GPT-5.6 <ChevronDown size={13} /></button>
            <button
              class="send-button"
              disabled={!canSend()}
              aria-label="Send message"
              onClick={submit}
            >
              <ArrowRight size={18} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>
      <p class="composer-hint">Orbit can make mistakes. Review changes before merging.</p>
    </div>
  );
}
