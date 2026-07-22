import { Copy, Files, GitBranch, PanelRight, RefreshCw, Terminal } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { TimelineItem } from "@/features/agent-timeline";
import type { WorkspaceGitSnapshot } from "../../../../../shared/desktop-contracts";
import type { InspectorTab } from "../model";
import {
  diffFilesFromGitPatch,
  diffFilesFromTimeline,
  mergeReviewDiffFiles,
  terminalLinesFromTimeline,
} from "../diff-from-timeline";
import { IconButton } from "@/shared/ui/icon-button";
import { Tabs } from "@/shared/ui/tabs";
import { TerminalPreview } from "./inspector/terminal-preview";
import { WorkspaceTree } from "./inspector/workspace-tree";

type InspectorProps = {
  cwd: string | null;
  items: TimelineItem[];
  onCollapse: () => void;
  onOpenReview: (path?: string | null) => void;
  onTabChange: (tab: InspectorTab) => void;
  refreshToken?: number;
  tab: InspectorTab;
};

export function Inspector(props: InspectorProps) {
  const [git, setGit] = createSignal<WorkspaceGitSnapshot | null>(null);
  const [gitError, setGitError] = createSignal<string | null>(null);
  const [loadingGit, setLoadingGit] = createSignal(false);

  createEffect(() => {
    const cwd = props.cwd;
    props.refreshToken;
    if (!cwd) {
      setGit(null);
      setGitError(null);
      return;
    }
    void loadGit(cwd);
  });

  async function loadGit(cwd: string): Promise<void> {
    setLoadingGit(true);
    setGitError(null);
    try {
      setGit(await window.piDesktop.workspace.git(cwd));
    } catch (error) {
      setGit(null);
      setGitError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingGit(false);
    }
  }

  const sessionFiles = createMemo(() => diffFilesFromTimeline(props.items));
  const gitFiles = createMemo(() => diffFilesFromGitPatch(git()?.patch));
  const files = createMemo(() =>
    mergeReviewDiffFiles(sessionFiles(), gitFiles(), git()?.files ?? []),
  );
  const terminalLines = createMemo(() => terminalLinesFromTimeline(props.items));
  const changedPaths = createMemo(() => [
    ...files().map((file) => file.path),
    ...(git()?.files.map((file) => file.path) ?? []),
  ]);
  const changedPathSet = createMemo(() => new Set(changedPaths()));
  const branchLabel = createMemo(() => {
    const snapshot = git();
    if (!props.cwd) return "No workspace";
    if (loadingGit()) return "Reading git…";
    if (gitError()) return "Git unavailable";
    if (!snapshot?.isRepo) return "Not a git repo";
    return snapshot.branch ?? "HEAD";
  });

  return (
    <aside
      class="inspector"
      classList={{
        "inspector--files": props.tab === "files",
        "inspector--terminal": props.tab === "terminal",
      }}
    >
      <Tabs
        value={props.tab}
        onValueChange={(value) => props.onTabChange(value as InspectorTab)}
        trailing={
          <IconButton label="Collapse inspector" size="sm" onClick={props.onCollapse}>
            <PanelRight size={15} />
          </IconButton>
        }
        items={[
          {
            value: "files",
            label: "Files",
            icon: <Files size={16} />,
          },
          {
            value: "terminal",
            label: "Terminal",
            badge: String(terminalLines().length),
            icon: <Terminal size={16} />,
          },
        ]}
      />
      <div class="branch-bar">
        <span>
          <GitBranch size={15} /> {branchLabel()}
        </span>
        <div class="branch-bar-actions">
          <button
            type="button"
            aria-label="Refresh git status"
            onClick={() => {
              if (props.cwd) void loadGit(props.cwd);
            }}
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (props.cwd) void navigator.clipboard.writeText(props.cwd);
            }}
          >
            <Copy size={14} /> Copy
          </button>
        </div>
      </div>
      <Show when={props.tab === "files"}>
        <WorkspaceTree
          cwd={props.cwd}
          changedPaths={changedPaths()}
          mode="panel"
          onOpenPath={(path) => {
            if (changedPathSet().has(path)) props.onOpenReview(path);
          }}
        />
      </Show>
      <Show when={props.tab === "terminal"}>
        <TerminalPreview lines={terminalLines()} />
      </Show>
    </aside>
  );
}
