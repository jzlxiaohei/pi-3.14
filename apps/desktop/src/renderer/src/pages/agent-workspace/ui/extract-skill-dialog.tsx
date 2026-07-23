import { LoaderCircle, Sparkles, X } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { TimelineItem } from "@/features/agent-timeline";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import {
  canExtractFromTurns,
  chatTurnsFromItems,
  sliceTurns,
  type ChatTurn,
} from "../extract-skill";

type ExtractSkillDialogProps = {
  open: boolean;
  items: TimelineItem[];
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: (turns: ChatTurn[]) => void | Promise<void>;
};

export function ExtractSkillDialog(props: ExtractSkillDialogProps) {
  const turns = createMemo(() => chatTurnsFromItems(props.items));
  const [mode, setMode] = createSignal<"full" | "range">("full");
  const [fromId, setFromId] = createSignal<string | null>(null);
  const [toId, setToId] = createSignal<string | null>(null);
  const [starting, setStarting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (!props.open) return;
    setMode("full");
    setError(null);
    setStarting(false);
    const list = turns();
    setFromId(list[0]?.id ?? null);
    setToId(list.at(-1)?.id ?? null);
  });

  const selectedTurns = createMemo(() => {
    const list = turns();
    return mode() === "full" ? list : sliceTurns(list, fromId(), toId());
  });

  const gate = createMemo(() => canExtractFromTurns(selectedTurns()));

  async function start(): Promise<void> {
    if (starting()) return;
    const check = gate();
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    setStarting(true);
    setError(null);
    try {
      await props.onStart(selectedTurns());
      props.onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog
      class="orbit-dialog__content--compact"
      open={props.open}
      title="协助抽取 Skill"
      onOpenChange={(open) => {
        if (starting()) return;
        props.onOpenChange(open);
      }}
    >
      <div class="confirm-dialog">
        <header class="confirm-dialog__header">
          <h2>协助抽取 Skill</h2>
          <IconButton
            label="Close"
            size="sm"
            disabled={starting()}
            onClick={() => props.onOpenChange(false)}
          >
            <X size={14} />
          </IconButton>
        </header>
        <div class="confirm-dialog__body">
          <p>
            将在<strong>新的独立 session</strong>里抽取（不污染当前对话）。落盘默认写入个人 PI 库{" "}
            <code>~/.pi/agent/skills</code>，需你确认后才写入。
          </p>
          <div class="extract-scope">
            <label class="extract-scope__option">
              <input
                type="radio"
                name="extract-scope"
                checked={mode() === "full"}
                onChange={() => setMode("full")}
              />
              <span>整段 transcript（默认）</span>
            </label>
            <label class="extract-scope__option">
              <input
                type="radio"
                name="extract-scope"
                checked={mode() === "range"}
                onChange={() => setMode("range")}
              />
              <span>框选消息范围</span>
            </label>
          </div>
          <Show when={mode() === "range"}>
            <div class="extract-range">
              <label>
                从
                <select
                  value={fromId() ?? ""}
                  onChange={(event) => setFromId(event.currentTarget.value || null)}
                >
                  <For each={turns()}>
                    {(turn) => (
                      <option value={turn.id}>
                        {turn.kind} · {preview(turn.text)}
                      </option>
                    )}
                  </For>
                </select>
              </label>
              <label>
                到
                <select
                  value={toId() ?? ""}
                  onChange={(event) => setToId(event.currentTarget.value || null)}
                >
                  <For each={turns()}>
                    {(turn) => (
                      <option value={turn.id}>
                        {turn.kind} · {preview(turn.text)}
                      </option>
                    )}
                  </For>
                </select>
              </label>
            </div>
          </Show>
          <p class="confirm-dialog__note">
            已选 {selectedTurns().length} 条消息 ·{" "}
            {selectedTurns().reduce((sum, turn) => sum + turn.text.length, 0)} 字符
          </p>
          <Show when={!gate().ok}>
            <p class="confirm-dialog__error">{(gate() as { reason: string }).reason}</p>
          </Show>
          <Show when={error()}>
            {(message) => <p class="confirm-dialog__error">{message()}</p>}
          </Show>
        </div>
        <footer class="confirm-dialog__footer">
          <Button variant="secondary" disabled={starting()} onClick={() => props.onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={props.disabled || starting() || !gate().ok}
            onClick={() => void start()}
          >
            <Show when={starting()} fallback={<Sparkles size={14} />}>
              <LoaderCircle size={14} class="spin" />
            </Show>
            {starting() ? "开启抽取…" : "开始抽取"}
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}

function preview(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 48 ? `${oneLine.slice(0, 48)}…` : oneLine;
}
