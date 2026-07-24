import { Archive, X } from "lucide-solid";
import type { WorkspaceTask } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";

type ArchiveTaskDialogProps = {
  task: WorkspaceTask | null;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
};

export function ArchiveTaskDialog(props: ArchiveTaskDialogProps) {
  return (
    <Dialog
      class="orbit-dialog__content--compact"
      open={props.task != null}
      title="归档任务"
      onOpenChange={props.onOpenChange}
    >
      <div class="confirm-dialog">
        <header class="confirm-dialog__header">
          <h2>归档任务</h2>
          <IconButton
            label="Close"
            size="sm"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            <X size={14} />
          </IconButton>
        </header>
        <div class="confirm-dialog__body">
          <p>
            归档「{props.task?.title ?? "此任务"}」。默认列表会隐藏它；勾选「显示已归档」仍可查看并恢复。
          </p>
          <p class="confirm-dialog__note">会话 JSONL 会保留在本地，不会删除。</p>
        </div>
        <footer class="confirm-dialog__footer">
          <Button
            variant="secondary"
            disabled={props.busy}
            onClick={() => props.onOpenChange(false)}
          >
            取消
          </Button>
          <Button variant="primary" disabled={props.busy} onClick={() => void props.onConfirm()}>
            <Archive size={14} />
            归档
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
