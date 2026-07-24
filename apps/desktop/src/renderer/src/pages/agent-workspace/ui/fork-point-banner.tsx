import { GitFork } from "lucide-solid";
import { For, Show, createEffect, createSignal } from "solid-js";
import type {
  PiBranchForkChip,
  PiBranchTreeNode,
} from "../../../../../shared/desktop-contracts";
import { findBranchLeaf } from "../../../../../shared/branch-tree";

type ForkPointBannerProps = {
  enabled: boolean;
  busy?: boolean;
  refreshToken?: number;
  onSwitch: (entryId: string) => void;
};

/** Shown when the active leaf sits at a fork parent (no user child on the path). */
export function ForkPointBanner(props: ForkPointBannerProps) {
  const [forks, setForks] = createSignal<PiBranchForkChip[]>([]);
  const [roots, setRoots] = createSignal<PiBranchTreeNode[]>([]);

  createEffect(() => {
    if (!props.enabled) {
      setForks([]);
      return;
    }
    props.refreshToken;
    void load();
  });

  async function load(): Promise<void> {
    try {
      const inspect = await window.piDesktop.session.inspect();
      setRoots(inspect.branchTree);
      setForks(inspect.branchSpine.forkPoint?.siblingForks ?? []);
    } catch {
      setForks([]);
      setRoots([]);
    }
  }

  return (
    <Show when={forks().length > 0}>
      <div class="fork-point-banner" role="status">
        <div class="fork-point-banner__copy">
          <GitFork size={14} />
          <span>位于分叉点 · {forks().length} 个旁支</span>
        </div>
        <div class="branches-fork-chips">
          <For each={forks()}>
            {(fork) => (
              <button
                type="button"
                class="branches-fork-chip"
                disabled={props.busy}
                title={fork.label}
                onClick={() => {
                  const leaf = findBranchLeaf(roots(), fork.entryId) ?? fork.entryId;
                  props.onSwitch(leaf);
                }}
              >
                {fork.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
