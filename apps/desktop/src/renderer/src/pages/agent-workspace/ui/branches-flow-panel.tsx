import { GitFork, X } from "lucide-solid";
import { Show, createEffect, createSignal } from "solid-js";
import type {
  PiBranchFlowGraph,
  PiBranchTreeNode,
} from "../../../../../shared/desktop-contracts";
import { findBranchLeaf } from "../../../../../shared/branch-tree";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import {
  BranchesFlowCanvas,
  type BranchesFlowSelection,
} from "./branches-flow-canvas";

type BranchesFlowPanelProps = {
  open: boolean;
  busy?: boolean;
  refreshToken?: number;
  onClose: () => void;
  /** Navigate to branch leaf; `viewEntryId` is the message to scroll to after switch. */
  onSwitch: (navigateId: string, viewEntryId: string) => void;
  onGoto: (entryId: string) => void;
};

const EMPTY_FLOW: PiBranchFlowGraph = {
  nodes: [],
  edges: [],
  forkPoint: null,
};

export function BranchesFlowPanel(props: BranchesFlowPanelProps) {
  const [graph, setGraph] = createSignal<PiBranchFlowGraph>(EMPTY_FLOW);
  const [branchPoints, setBranchPoints] = createSignal(0);
  const [error, setError] = createSignal<string | null>(null);
  const [treeRoots, setTreeRoots] = createSignal<PiBranchTreeNode[]>([]);
  const [selected, setSelected] = createSignal<BranchesFlowSelection | null>(null);

  createEffect(() => {
    if (!props.open) return;
    props.refreshToken;
    void load();
  });

  async function load(): Promise<void> {
    setError(null);
    setSelected(null);
    try {
      const inspect = await window.piDesktop.session.inspect();
      setGraph(inspect.branchFlow);
      setTreeRoots(inspect.branchTree);
      setBranchPoints(inspect.analysis?.branchPointCount ?? 0);
    } catch (err) {
      setGraph(EMPTY_FLOW);
      setTreeRoots([]);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function switchSelected(): void {
    const node = selected();
    if (!node || node.onActivePath || node.kind !== "user") return;
    const leaf = findBranchLeaf(treeRoots(), node.id) ?? node.id;
    props.onSwitch(leaf, node.id);
  }

  const canSwitch = () => {
    const node = selected();
    return Boolean(node && !node.onActivePath && node.kind === "user");
  };

  return (
    <Dialog
      class="orbit-dialog__content--branches"
      open={props.open}
      title="Session branches"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <div class="branches-flow-panel">
        <header class="branches-flow-panel__header">
          <div class="branches-flow-panel__title">
            <GitFork size={16} />
            <strong>Branches</strong>
            <Show when={branchPoints() > 0}>
              <span class="branches-flow-panel__count">{branchPoints()}</span>
            </Show>
          </div>
          <div class="branches-flow-panel__actions">
            <IconButton label="Close branches" size="sm" onClick={props.onClose}>
              <X size={15} />
            </IconButton>
          </div>
        </header>

        <p class="branches-flow-panel__hint">
          图只读。发灰 /「旧回复」是 edit 后留下的旁支，不是工具自己分叉。切换旁支可继续聊。
        </p>

        <Show when={graph().forkPoint}>
          {(forkPoint) => (
            <div class="branches-fork-point branches-flow-panel__fork" role="status">
              <GitFork size={14} />
              <p class="branches-fork-point__label">
                位于分叉点 · {forkPoint().siblingForks.length} 个旁支 — 选中旁支后在下方切换
              </p>
            </div>
          )}
        </Show>

        <Show when={error()}>
          <p class="inspector-empty">{error()}</p>
        </Show>

        <Show when={!error()}>
          <BranchesFlowCanvas
            graph={graph()}
            busy={props.busy}
            onSelect={setSelected}
            onGoto={props.onGoto}
          />
        </Show>

        <footer class="branches-flow-panel__footer branches-flow-panel__footer--actions">
          <Show
            when={canSwitch()}
            fallback={<span>Read-only map · 旧旁支可切回继续聊</span>}
          >
            <div class="branches-flow-panel__switch">
              <Button
                variant="primary"
                disabled={props.busy}
                onClick={() => switchSelected()}
              >
                切换到所选旁支
              </Button>
            </div>
          </Show>
        </footer>
      </div>
    </Dialog>
  );
}
