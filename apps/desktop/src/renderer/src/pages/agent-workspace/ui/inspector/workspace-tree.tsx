import { ChevronDown, ChevronRight, File, Folder, GitBranch, RefreshCw } from "lucide-solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import type { WorkspaceDirEntry } from "../../../../../../shared/desktop-contracts";

type WorkspaceTreeProps = {
  cwd: string | null;
  changedPaths?: string[];
  /** `panel` = Files tab (always expanded). `drawer` = optional collapsible strip. */
  mode?: "panel" | "drawer";
  /** Drawer-only: start collapsed. */
  defaultCollapsed?: boolean;
  /** Optional git branch label shown in the panel tree head. */
  branchLabel?: string | null;
  onRefreshGit?: () => void;
  onOpenPath?: (path: string) => void;
};

export function WorkspaceTree(props: WorkspaceTreeProps) {
  const [rootKey, setRootKey] = createSignal(0);
  const isPanel = () => (props.mode ?? "panel") === "panel";
  const [collapsed, setCollapsed] = createSignal(
    !isPanel() && props.defaultCollapsed === true,
  );
  const changed = () => new Set(props.changedPaths ?? []);

  createEffect(() => {
    props.cwd;
    setRootKey((value) => value + 1);
  });

  createEffect(() => {
    if (isPanel()) {
      setCollapsed(false);
      return;
    }
    setCollapsed(props.defaultCollapsed === true);
  });

  function refreshAll() {
    setRootKey((v) => v + 1);
    props.onRefreshGit?.();
  }

  return (
    <div
      class="tree-panel"
      classList={{
        "tree-panel--panel": isPanel(),
        "tree-panel--collapsed": !isPanel() && collapsed(),
      }}
    >
      <div class="tree-head">
        <Show
          when={isPanel()}
          fallback={
            <button
              type="button"
              class="tree-head__toggle"
              aria-expanded={!collapsed()}
              onClick={() => setCollapsed((value) => !value)}
            >
              {collapsed() ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <span>Workspace files</span>
            </button>
          }
        >
          <div class="tree-head__leading">
            <span class="tree-head__title">Workspace files</span>
            <Show when={props.branchLabel}>
              {(label) => (
                <span class="tree-head__branch" title={label()}>
                  <GitBranch size={12} />
                  {label()}
                </span>
              )}
            </Show>
          </div>
        </Show>
        <Show when={isPanel() || !collapsed()}>
          <button
            type="button"
            class="tree-refresh"
            aria-label="Refresh file tree"
            onClick={refreshAll}
          >
            <RefreshCw size={15} />
          </button>
        </Show>
      </div>
      <Show when={isPanel() || !collapsed()}>
        <Show
          when={props.cwd}
          fallback={<p class="inspector-empty">Select a workspace to browse files.</p>}
        >
          {(cwd) => (
            <div class="workspace-tree__list" data-key={rootKey()}>
              <TreeFolder
                cwd={cwd()}
                entry={{
                  name: cwd().split(/[\\/]/).filter(Boolean).at(-1) ?? cwd(),
                  path: "",
                  type: "folder",
                }}
                depth={0}
                changed={changed()}
                defaultOpen
                reloadToken={rootKey()}
                onOpenPath={props.onOpenPath}
              />
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

type NodeProps = {
  cwd: string;
  entry: WorkspaceDirEntry;
  depth: number;
  changed: Set<string>;
  defaultOpen?: boolean;
  reloadToken: number;
  onOpenPath?: (path: string) => void;
};

function TreeFolder(props: NodeProps) {
  const [open, setOpen] = createSignal(props.defaultOpen === true);
  const [children, setChildren] = createSignal<WorkspaceDirEntry[] | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);

  createEffect(() => {
    props.reloadToken;
    setChildren(null);
    setError(null);
    if (props.defaultOpen) {
      setOpen(true);
      void load();
    } else {
      setOpen(false);
    }
  });

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const result = await window.piDesktop.workspace.list({
        cwd: props.cwd,
        path: props.entry.path,
      });
      setChildren(result.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setChildren([]);
    } finally {
      setLoading(false);
    }
  }

  async function toggle(): Promise<void> {
    const next = !open();
    setOpen(next);
    if (next && children() === null) await load();
  }

  return (
    <div class="workspace-tree__branch">
      <button
        type="button"
        class="tree-row"
        style={{ "padding-left": `${10 + props.depth * 14}px` }}
        onClick={() => void toggle()}
      >
        <span class="workspace-tree__indicator">
          {open() ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span class="workspace-tree__label">
          <Folder size={15} />
          <span>{props.entry.name}</span>
        </span>
      </button>
      <Show when={open()}>
        <Show when={loading()}>
          <p class="tree-muted" style={{ "padding-left": `${28 + props.depth * 14}px` }}>
            Loading…
          </p>
        </Show>
        <Show when={error()}>
          <p class="tree-muted" style={{ "padding-left": `${28 + props.depth * 14}px` }}>
            {error()}
          </p>
        </Show>
        <For each={children() ?? []}>
          {(child) =>
            child.type === "folder" ? (
              <TreeFolder
                cwd={props.cwd}
                entry={child}
                depth={props.depth + 1}
                changed={props.changed}
                reloadToken={props.reloadToken}
                onOpenPath={props.onOpenPath}
              />
            ) : (
              <button
                type="button"
                class="tree-row workspace-tree__item"
                classList={{ "is-changed": props.changed.has(child.path) }}
                style={{ "padding-left": `${28 + props.depth * 14}px` }}
                onClick={() => props.onOpenPath?.(child.path)}
              >
                <span class="workspace-tree__label">
                  <File size={15} />
                  <span>{child.name}</span>
                </span>
                <Show when={props.changed.has(child.path)}>
                  <b>M</b>
                </Show>
              </button>
            )
          }
        </For>
      </Show>
    </div>
  );
}
