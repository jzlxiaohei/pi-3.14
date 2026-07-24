import { Route, X } from "lucide-solid";
import { For } from "solid-js";
import type { TaskPlaybookId } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import { PLAYBOOKS } from "../workflow/playbooks";

type NewTaskDialogProps = {
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` = skip playbook (free chat). */
  onConfirm: (playbookId: TaskPlaybookId | null) => void | Promise<void>;
};

export function NewTaskDialog(props: NewTaskDialogProps) {
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
          <p>选一条工程路径，或跳过直接自由 chat。路径会定下初始走向（第一步 starter）。</p>
          <div class="new-task-paths">
            <For each={PLAYBOOKS}>
              {(playbook) => (
                <button
                  type="button"
                  class="new-task-paths__item"
                  disabled={props.disabled}
                  onClick={() => void props.onConfirm(playbook.id)}
                >
                  <Route size={14} />
                  <span>
                    <strong>{playbook.title}</strong>
                    <small>{playbook.description}</small>
                  </span>
                </button>
              )}
            </For>
          </div>
          <p class="confirm-dialog__note">
            Slash starter 依赖项目 <code>.pi/skills</code>。Skills 安装与管理将在独立 Skills
            页完成，不在 chat 顶栏。
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
