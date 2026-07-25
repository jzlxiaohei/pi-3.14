import { Route, X } from "lucide-solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import type { PlaybookTemplate } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";

type NewTaskDialogProps = {
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = skip playbook (free chat). */
  onConfirm: (playbookId: string | null) => void | Promise<void>;
};

export function NewTaskDialog(props: NewTaskDialogProps) {
  const [playbooks, setPlaybooks] = createSignal<PlaybookTemplate[]>([]);
  const [loading, setLoading] = createSignal(false);

  createEffect(() => {
    if (!props.open) return;
    setLoading(true);
    void window.piDesktop.playbooks
      .list()
      .then(setPlaybooks)
      .catch(() => setPlaybooks([]))
      .finally(() => setLoading(false));
  });

  return (
    <Dialog
      class="orbit-dialog__content--compact"
      open={props.open}
      title="New task"
      onOpenChange={props.onOpenChange}
    >
      <div class="confirm-dialog">
        <header class="confirm-dialog__header">
          <h2>New task</h2>
          <IconButton
            label="Close"
            size="sm"
            disabled={props.disabled}
            onClick={() => props.onOpenChange(false)}
          >
            <X size={14} />
          </IconButton>
        </header>
        <div class="confirm-dialog__body">
          <p>选一条工程路径，或跳过直接自由 chat。路径来自「路径模板」库，可自定义步骤与 Agent Template。</p>
          <div class="new-task-paths">
            <Show when={loading()}>
              <p class="confirm-dialog__note">加载路径…</p>
            </Show>
            <For each={playbooks()}>
              {(playbook) => (
                <button
                  type="button"
                  class="new-task-paths__item"
                  disabled={props.disabled || loading()}
                  onClick={() => void props.onConfirm(playbook.id)}
                >
                  <Route size={14} />
                  <span>
                    <strong>{playbook.name}</strong>
                    <small>
                      {playbook.description || `${playbook.steps.length} 步`}
                    </small>
                  </span>
                </button>
              )}
            </For>
            <Show when={!loading() && playbooks().length === 0}>
              <p class="confirm-dialog__note">还没有路径模板。请先在左侧 Rail「Paths」中创建或等待系统种子加载。</p>
            </Show>
          </div>
          <p class="confirm-dialog__note">
            Starter 依赖项目 skills（建议用法）。Agent Role Prompt 在各自 Agent Template 中维护。
          </p>
        </div>
        <footer class="confirm-dialog__footer">
          <Button
            variant="secondary"
            disabled={props.disabled}
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            variant="primary"
            disabled={props.disabled}
            onClick={() => void props.onConfirm(null)}
          >
            跳过，自由 chat
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
