import {
  Check,
  Columns2,
  FileCode,
  GitBranch,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Rows2,
  X,
} from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { WorkspaceGitSnapshot } from "../../../../shared/desktop-contracts";
import { IconButton } from "@/shared/ui/icon-button";
import { Select } from "@/shared/ui/select";
import { Tooltip } from "@/shared/ui/tooltip";
import {
  diffFilesFromGitPatch,
  mergeReviewDiffFiles,
} from "../agent-workspace/diff-from-timeline";
import type { DiffFile, DiffHunk, DiffLine } from "../agent-workspace/model";
import { splitRowsFromHunk, type SplitSide } from "./split-diff";

type DiffLayout = "split" | "unified";

export type DiffReviewPanelProps = {
  cwd: string;
  initialPath?: string | null;
  onClose: () => void;
};

/** In-app review surface (prefer Dialog host; no second BrowserWindow). */
export function DiffReviewPanel(props: DiffReviewPanelProps) {
  const [git, setGit] = createSignal<WorkspaceGitSnapshot | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [selectedPath, setSelectedPath] = createSignal<string | null>(props.initialPath ?? null);
  const [discardingPath, setDiscardingPath] = createSignal<string | null>(null);
  const [layout, setLayout] = createSignal<DiffLayout>("split");
  const [reviewedPaths, setReviewedPaths] = createSignal<string[]>(loadReviewedPaths(props.cwd));
  const [baseRef, setBaseRef] = createSignal<string | null>(loadBaseRef(props.cwd));

  createEffect(() => {
    const cwd = props.cwd;
    setReviewedPaths(loadReviewedPaths(cwd));
    setSelectedPath(props.initialPath ?? null);
    setBaseRef(loadBaseRef(cwd));
    void loadGit(cwd, loadBaseRef(cwd));
  });

  const files = createMemo(() => {
    const snapshot = git();
    return mergeReviewDiffFiles([], diffFilesFromGitPatch(snapshot?.patch), snapshot?.files ?? []);
  });

  createEffect(() => {
    const cwd = props.cwd;
    const paths = new Set(files().map((file) => file.path));
    setReviewedPaths((current) => {
      const next = current.filter((path) => paths.has(path));
      persistReviewedPaths(cwd, next);
      return next.length === current.length && next.every((path, i) => path === current[i])
        ? current
        : next;
    });
  });

  const selectedFile = createMemo(() => {
    const list = files();
    const path = selectedPath();
    if (!path) return list[0] ?? null;
    return list.find((file) => file.path === path) ?? list[0] ?? null;
  });

  createEffect(() => {
    const file = selectedFile();
    if (file && selectedPath() !== file.path) setSelectedPath(file.path);
  });

  const totals = createMemo(() =>
    files().reduce(
      (summary, file) => ({
        additions: summary.additions + file.additions,
        deletions: summary.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 },
    ),
  );

  const reviewedCount = createMemo(() => {
    const paths = new Set(reviewedPaths());
    return files().filter((file) => paths.has(file.path)).length;
  });

  const allReviewed = createMemo(
    () => files().length > 0 && reviewedCount() === files().length,
  );

  const compare = createMemo(() => compareLabel(git()));
  const baseOptions = createMemo(() =>
    (git()?.bases ?? []).map((ref) => ({ label: ref, value: ref })),
  );

  function isReviewed(path: string): boolean {
    return reviewedPaths().includes(path);
  }

  function setReviewed(path: string, reviewed: boolean): void {
    setReviewedPaths((current) => {
      const next = reviewed
        ? current.includes(path)
          ? current
          : [...current, path]
        : current.filter((item) => item !== path);
      persistReviewedPaths(props.cwd, next);
      return next;
    });
  }

  function markReviewedAndAdvance(path: string): void {
    const list = files();
    const index = list.findIndex((file) => file.path === path);
    const updated = new Set([...reviewedPaths(), path]);
    setReviewed(path, true);
    const next = list
      .slice(index + 1)
      .concat(list.slice(0, Math.max(index, 0)))
      .find((file) => !updated.has(file.path));
    if (next) setSelectedPath(next.path);
  }

  async function loadGit(cwd: string, nextBase: string | null): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await window.piDesktop.workspace.git({ cwd, baseRef: nextBase });
      setGit(snapshot);
      setBaseRef(snapshot.baseRef);
      persistBaseRef(cwd, snapshot.baseRef);
    } catch (err) {
      setGit(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function selectBase(next: string): Promise<void> {
    if (next === baseRef()) return;
    setBaseRef(next);
    persistBaseRef(props.cwd, next);
    await loadGit(props.cwd, next);
  }

  async function discard(path: string): Promise<void> {
    if (discardingPath()) return;
    setDiscardingPath(path);
    setError(null);
    try {
      const result = await window.piDesktop.workspace.gitDiscard({ cwd: props.cwd, path });
      if (!result.ok) {
        if (result.cancelled) return;
        setError(result.error);
        return;
      }
      setReviewed(path, false);
      const snapshot = await window.piDesktop.workspace.git({
        cwd: props.cwd,
        baseRef: baseRef(),
      });
      setGit(snapshot);
      const nextFiles = mergeReviewDiffFiles([], diffFilesFromGitPatch(snapshot.patch), snapshot.files);
      setSelectedPath(nextFiles.find((file) => file.path !== path)?.path ?? nextFiles[0]?.path ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiscardingPath(null);
    }
  }

  return (
    <div class="review-window">
      <header class="review-window__header">
        <div>
          <span class="review-window__eyebrow" title={compareTitle(git())}>
            <GitBranch size={14} />
            <span class="review-compare">
              <span class="review-compare__source">{compare().source}</span>
              <span class="review-compare__arrow" aria-hidden="true">
                →
              </span>
              <Select
                class="review-compare__select"
                disabled={loading() || !git()?.isRepo || baseOptions().length === 0}
                options={baseOptions()}
                placeholder="base"
                value={
                  compare().target === "…" || compare().target === "—"
                    ? null
                    : compare().target
                }
                onValueChange={(value) => void selectBase(value)}
              />
            </span>
          </span>
          <h1>Review changes</h1>
          <p title={props.cwd}>{props.cwd}</p>
        </div>
        <div class="review-window__actions">
          <span class="review-progress" data-complete={allReviewed() ? "true" : undefined}>
            {reviewedCount()}/{files().length} reviewed
          </span>
          <span class="diff-stat">
            <b>+{totals().additions}</b>
            <i>-{totals().deletions}</i>
          </span>
          <div class="review-layout-toggle" role="group" aria-label="Diff layout">
            <IconButton
              label="Split diff"
              size="sm"
              active={layout() === "split"}
              onClick={() => setLayout("split")}
            >
              <Columns2 size={15} />
            </IconButton>
            <IconButton
              label="Unified diff"
              size="sm"
              active={layout() === "unified"}
              onClick={() => setLayout("unified")}
            >
              <Rows2 size={15} />
            </IconButton>
          </div>
          <button
            type="button"
            class="review-window__button"
            disabled={loading()}
            onClick={() => void loadGit(props.cwd, baseRef())}
          >
            <RefreshCw size={14} />
            {loading() ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            class="review-window__button review-window__button--primary"
            title={
              allReviewed()
                ? "All files reviewed"
                : `${reviewedCount()}/${files().length} files reviewed`
            }
            onClick={props.onClose}
          >
            Done
          </button>
          <IconButton label="Close review" size="sm" onClick={props.onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </header>

      <Show when={error()}>
        <p class="review-window__error">{error()}</p>
      </Show>

      <Show
        when={files().length > 0}
        fallback={<p class="review-window__empty">No working-tree changes to review.</p>}
      >
          <section class="review-layout">
            <aside class="review-file-list" aria-label="Changed files">
              <div class="review-file-list__head">
                <span>
                  {reviewedCount()}/{files().length} reviewed
                </span>
                <span class="diff-stat">
                  <b>+{totals().additions}</b>
                  <i>-{totals().deletions}</i>
                </span>
              </div>
              <For each={files()}>
                {(file) => (
                  <div
                    class="review-file-row"
                    classList={{
                      "is-selected": selectedFile()?.path === file.path,
                      "is-reviewed": isReviewed(file.path),
                    }}
                    onClick={() => setSelectedPath(file.path)}
                  >
                    <span
                      class="review-file-row__mark"
                      classList={{ "is-reviewed": isReviewed(file.path) }}
                      aria-hidden="true"
                    >
                      <Show when={isReviewed(file.path)} fallback={<span />}>
                        <Check size={12} />
                      </Show>
                    </span>
                    <span class={`diff-status diff-status--${file.status}`}>
                      {statusLetter(file.status)}
                    </span>
                    <span class="review-file-row__path">
                      <Tooltip label={file.path} openDelay={0} positioning="top">
                        <span class="review-file-row__path-text">
                          <span class="review-file-row__name">{fileName(file.path)}</span>
                          <Show when={fileDir(file.path)}>
                            {(dir) => <span class="review-file-row__dir">{dir()}</span>}
                          </Show>
                        </span>
                      </Tooltip>
                    </span>
                    <span class="diff-stat">
                      <Show when={file.additions > 0 || file.deletions > 0} fallback={<em>—</em>}>
                        <b>+{file.additions}</b>
                        <i>-{file.deletions}</i>
                      </Show>
                    </span>
                  </div>
                )}
              </For>
            </aside>
            <Show when={selectedFile()}>
              {(file) => (
                <DiffFileDetail
                  discarding={discardingPath() === file().path}
                  file={file()}
                  layout={layout()}
                  reviewed={isReviewed(file().path)}
                  onDiscard={() => void discard(file().path)}
                  onToggleReviewed={() => {
                    if (isReviewed(file().path)) {
                      setReviewed(file().path, false);
                      return;
                    }
                    markReviewedAndAdvance(file().path);
                  }}
                />
              )}
            </Show>
          </section>
      </Show>
    </div>
  );
}

/** Legacy hash-window entry; prefer DiffReviewPanel inside Dialog. */
export function DiffReviewRoute() {
  const target = readTarget();
  if (!target.cwd) {
    return <p class="review-window__empty">Open review from a task with a workspace.</p>;
  }
  return (
    <DiffReviewPanel
      cwd={target.cwd}
      initialPath={target.path}
      onClose={() => void window.piDesktop.workspace.closeReview()}
    />
  );
}

type ReviewTarget = {
  cwd: string | null;
  path: string | null;
};

function DiffFileDetail(props: {
  discarding: boolean;
  file: DiffFile;
  layout: DiffLayout;
  reviewed: boolean;
  onDiscard: () => void;
  onToggleReviewed: () => void;
}) {
  const [menuOpen, setMenuOpen] = createSignal(false);

  createEffect(() => {
    if (!menuOpen()) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".review-file-menu")) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    });
  });

  return (
    <section class="review-diff-detail">
      <div class="review-diff-detail__head">
        <div>
          <span>
            <FileCode size={16} />
            <small>{props.file.status}</small>
            <Show when={props.reviewed}>
              <small class="review-file-badge">reviewed</small>
            </Show>
          </span>
          <h2 title={props.file.path}>{props.file.path}</h2>
        </div>
        <div class="review-diff-detail__actions">
          <span class="diff-stat">
            <b>+{props.file.additions}</b>
            <i>-{props.file.deletions}</i>
          </span>
          <button
            type="button"
            class="review-window__button"
            classList={{ "review-window__button--reviewed": props.reviewed }}
            onClick={props.onToggleReviewed}
          >
            <Check size={14} />
            {props.reviewed ? "Reviewed" : "Mark reviewed"}
          </button>
          <div class="review-file-menu">
            <IconButton
              label="File actions"
              size="sm"
              active={menuOpen()}
              disabled={props.discarding}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={16} />
            </IconButton>
            <Show when={menuOpen()}>
              <div class="review-file-menu__panel" role="menu">
                <button
                  type="button"
                  class="review-file-menu__item review-file-menu__item--danger"
                  role="menuitem"
                  disabled={props.discarding}
                  onClick={() => {
                    setMenuOpen(false);
                    props.onDiscard();
                  }}
                >
                  <RotateCcw size={14} />
                  {props.discarding ? "Discarding…" : "Discard file…"}
                </button>
              </div>
            </Show>
          </div>
        </div>
      </div>
      <Show
        when={!props.file.binary && props.file.hunks.length > 0}
        fallback={
          <p class="review-window__empty">
            {props.file.binary
              ? "Binary or non-text change — open the file in the workspace to inspect."
              : props.file.status === "deleted"
                ? "File deleted in the working tree."
                : "No textual hunks for this file."}
          </p>
        }
      >
        <div class="review-diff-scroll">
          <For each={props.file.hunks}>
            {(hunk) => (
              <Show
                when={props.layout === "split"}
                fallback={
                  <pre class="code-block review-code-block" aria-label={`Code diff for ${props.file.path}`}>
                    <code>
                      <span class="code-row hunk" title={hunk.header}>
                        <em></em>
                        <em></em>
                        <span>{formatHunkHeader(hunk.header).label}</span>
                      </span>
                      <For each={hunk.lines}>{(line) => <UnifiedRow line={line} />}</For>
                    </code>
                  </pre>
                }
              >
                <SplitHunkView filePath={props.file.path} hunk={hunk} />
              </Show>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function UnifiedRow(props: { line: DiffLine }) {
  const prefix = () => {
    if (props.line.kind === "added") return "+";
    if (props.line.kind === "removed") return "-";
    return " ";
  };

  return (
    <span class={`code-row ${props.line.kind}`}>
      <em>{props.line.oldLine ?? ""}</em>
      <em>{props.line.newLine ?? ""}</em>
      <span>
        {prefix()}
        {props.line.content}
      </span>
    </span>
  );
}

function SplitHunkView(props: { filePath: string; hunk: DiffHunk }) {
  const rows = createMemo(() => splitRowsFromHunk(props.hunk));

  return (
    <div class="split-hunk" aria-label={`Split diff for ${props.filePath}`}>
      <HunkHeader header={props.hunk.header} />
      <div class="split-hunk__pane-labels">
        <span>Before</span>
        <span>After</span>
      </div>
      <div class="split-hunk__panes">
        <div class="split-pane" aria-label="Before">
          <For each={rows()}>{(row) => <SplitCell side={row.left} />}</For>
        </div>
        <div class="split-pane" aria-label="After">
          <For each={rows()}>{(row) => <SplitCell side={row.right} />}</For>
        </div>
      </div>
    </div>
  );
}

function SplitCell(props: { side: SplitSide }) {
  return (
    <div class={`split-cell split-cell--${props.side.kind}`}>
      <em>{props.side.line ?? ""}</em>
      <span>{props.side.content}</span>
    </div>
  );
}

function HunkHeader(props: { header: string }) {
  const parsed = () => formatHunkHeader(props.header);
  return (
    <div class="split-hunk__header" title={props.header}>
      <span class="split-hunk__header-meta">{parsed().label}</span>
      <Show when={parsed().context}>
        {(context) => <span class="split-hunk__header-context">{context()}</span>}
      </Show>
    </div>
  );
}

/** Humanize git hunk header: `@@ -5,10 +5,14 @@ import …` */
function formatHunkHeader(header: string): { label: string; context: string } {
  const match = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s@@\s*(.*)$/.exec(header);
  if (!match) return { label: header, context: "" };
  const oldStart = match[1]!;
  const oldCount = match[2] ?? "1";
  const newStart = match[3]!;
  const newCount = match[4] ?? "1";
  return {
    label: `Hunk −${oldStart},${oldCount} → +${newStart},${newCount}`,
    context: match[5]?.trim() ?? "",
  };
}

function readTarget(): ReviewTarget {
  const hash = window.location.hash.startsWith("#/review")
    ? window.location.hash.slice("#/review".length)
    : window.location.search;
  const query = hash.startsWith("?") ? hash.slice(1) : hash;
  const params = new URLSearchParams(query);
  return {
    cwd: params.get("cwd"),
    path: params.get("path"),
  };
}

/** Source branch → selected compare base (working tree vs baseRef). */
function compareLabel(snapshot: WorkspaceGitSnapshot | null): {
  source: string;
  target: string;
} {
  if (!snapshot) return { source: "Reading git…", target: "…" };
  if (!snapshot.isRepo) return { source: "Not a git repo", target: "—" };
  return {
    source: snapshot.branch ?? "HEAD",
    target: snapshot.baseRef || "HEAD",
  };
}

function compareTitle(snapshot: WorkspaceGitSnapshot | null): string {
  if (!snapshot?.isRepo) return "";
  const { source, target } = compareLabel(snapshot);
  return `Working tree on ${source} compared to ${target}`;
}

function baseStorageKey(cwd: string): string {
  return `pie.review.base:${cwd}`;
}

/** null = auto-pick default branch on next load. */
function loadBaseRef(cwd: string): string | null {
  try {
    return sessionStorage.getItem(baseStorageKey(cwd));
  } catch {
    return null;
  }
}

function persistBaseRef(cwd: string, baseRef: string): void {
  try {
    sessionStorage.setItem(baseStorageKey(cwd), baseRef);
  } catch {
    // ignore quota / private mode
  }
}

function statusLetter(status: DiffFile["status"]): string {
  switch (status) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    default:
      return "M";
  }
}

function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function fileDir(path: string): string | null {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

function reviewedStorageKey(cwd: string): string {
  return `pie.review.reviewed:${cwd}`;
}

function loadReviewedPaths(cwd: string | null): string[] {
  if (!cwd) return [];
  try {
    const raw = sessionStorage.getItem(reviewedStorageKey(cwd));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function persistReviewedPaths(cwd: string, paths: string[]): void {
  try {
    sessionStorage.setItem(reviewedStorageKey(cwd), JSON.stringify(paths));
  } catch {
    // Ignore quota / private-mode failures; review progress stays in-memory.
  }
}
