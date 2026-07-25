import { Braces, Files, PanelRight, Terminal } from "lucide-solid";
import { createEffect, createMemo, createSignal, Show } from "solid-js";
import type { TimelineItem } from "@/features/agent-timeline";
import type { Agent, WorkspaceGitSnapshot } from "../../../../../shared/desktop-contracts";
import type { InspectorTab } from "../model";
import {
  diffFilesFromGitPatch,
  diffFilesFromTimeline,
  mergeReviewDiffFiles,
  terminalLinesFromTimeline,
} from "../diff-from-timeline";
import { IconButton } from "@/shared/ui/icon-button";
import { Tabs } from "@/shared/ui/tabs";
import { ContextPreview } from "./inspector/context-preview";
import { TerminalPreview } from "./inspector/terminal-preview";
import { WorkspaceTree } from "./inspector/workspace-tree";

type InspectorProps = {
  cwd: string | null;
  items: TimelineItem[];
  onCollapse: () => void;
  onOpenReview: (path?: string | null) => void;
  onTabChange: (tab: InspectorTab) => void;
  ready?: boolean;
  refreshToken?: number;
  tab: InspectorTab;
  ignoredSkillNames?: string[];
  /** Active Agent — Role Prompt shown read-only in Context. */
  agent?: Agent | null;
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
    if (!props.cwd) return null;
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
          {
            value: "context",
            label: "Context",
            icon: <Braces size={16} />,
          },
        ]}
      />
      <div class="inspector-body">
        {/* Keep Files/Terminal mounted so tab switch does not remount the tree or flash surfaces. */}
        <div
          class="inspector-pane"
          data-pane="files"
          hidden={props.tab !== "files"}
        >
          <WorkspaceTree
            cwd={props.cwd}
            changedPaths={changedPaths()}
            mode="panel"
            branchLabel={branchLabel()}
            onRefreshGit={() => {
              if (props.cwd) void loadGit(props.cwd);
            }}
            onOpenPath={(path) => {
              if (changedPathSet().has(path)) props.onOpenReview(path);
            }}
          />
        </div>
        <div
          class="inspector-pane"
          data-pane="terminal"
          hidden={props.tab !== "terminal"}
        >
          <TerminalPreview lines={terminalLines()} />
        </div>
        <Show when={props.tab === "context"}>
          <div class="inspector-pane" data-pane="context">
            <ContextPreview
              ready={Boolean(props.ready)}
              refreshToken={props.refreshToken}
              ignoredSkillNames={props.ignoredSkillNames}
              agent={props.agent}
            />
          </div>
        </Show>
      </div>
    </aside>
  );
}
