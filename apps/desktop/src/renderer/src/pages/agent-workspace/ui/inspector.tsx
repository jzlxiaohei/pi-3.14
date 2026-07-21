import { Copy, GitBranch, GitCompareArrows, RefreshCw, Terminal } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { TimelineItem } from "@/features/agent-timeline";
import type { WorkspaceGitSnapshot } from "../../../../../shared/desktop-contracts";
import type { InspectorTab } from "../model";
import {
  diffFilesFromGitPatch,
  diffFilesFromTimeline,
  mergeDiffFiles,
  terminalLinesFromTimeline,
} from "../diff-from-timeline";
import { Tabs } from "@/shared/ui/tabs";
import { DiffPreview } from "./inspector/diff-preview";
import { TerminalPreview } from "./inspector/terminal-preview";
import { WorkspaceTree } from "./inspector/workspace-tree";

type InspectorProps = {
  cwd: string | null;
  items: TimelineItem[];
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
  const files = createMemo(() => mergeDiffFiles(sessionFiles(), gitFiles()));
  const terminalLines = createMemo(() => terminalLinesFromTimeline(props.items));
  const changedPaths = createMemo(() => [
    ...files().map((file) => file.path),
    ...(git()?.files.map((file) => file.path) ?? []),
  ]);
  const branchLabel = createMemo(() => {
    const snapshot = git();
    if (!props.cwd) return "No workspace";
    if (loadingGit()) return "Reading git…";
    if (gitError()) return "Git unavailable";
    if (!snapshot?.isRepo) return "Not a git repo";
    return snapshot.branch ?? "HEAD";
  });

  return (
    <aside class="inspector">
      <Tabs
        value={props.tab}
        onValueChange={(value) => props.onTabChange(value as InspectorTab)}
        items={[
          {
            value: "changes",
            label: "Changes",
            badge: String(Math.max(files().length, git()?.files.length ?? 0)),
            icon: <GitCompareArrows size={16} />
          },
          {
            value: "terminal",
            label: "Terminal",
            badge: String(terminalLines().length),
            icon: <Terminal size={16} />
          }
        ]}
      />
      <div class="branch-bar">
        <span><GitBranch size={15} /> {branchLabel()}</span>
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
      <Show when={git() && git()!.isRepo && git()!.files.length > 0 && props.tab === "changes"}>
        <p class="git-status-summary">
          Working tree: {git()!.files.length} changed
          <Show when={git()!.upstream}> · tracking {git()!.upstream}</Show>
        </p>
      </Show>
      {props.tab === "changes" ? (
        <DiffPreview files={files()} />
      ) : (
        <TerminalPreview lines={terminalLines()} />
      )}
      <WorkspaceTree cwd={props.cwd} changedPaths={changedPaths()} />
    </aside>
  );
}
