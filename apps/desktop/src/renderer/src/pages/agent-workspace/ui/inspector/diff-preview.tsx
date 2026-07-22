import { FileCode, MoreHorizontal, RotateCcw } from "lucide-solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { IconButton } from "@/shared/ui/icon-button";
import type { DiffFile, DiffLine } from "../../model";

type DiffPreviewProps = {
  canDiscard?: boolean;
  discardingPath?: string | null;
  files: DiffFile[];
  onDiscard?: (path: string) => void;
  onSelectPath?: (path: string) => void;
  selectedPath?: string | null;
};

export function DiffPreview(props: DiffPreviewProps) {
  const [internalPath, setInternalPath] = createSignal<string | null>(null);

  const selectedPath = createMemo(() => {
    const controlled = props.selectedPath;
    if (controlled !== undefined && controlled !== null) return controlled;
    return internalPath();
  });

  const selectedFile = createMemo(() => {
    const path = selectedPath();
    if (!path) return props.files[0] ?? null;
    return props.files.find((file) => file.path === path) ?? props.files[0] ?? null;
  });

  createEffect(() => {
    const files = props.files;
    if (files.length === 0) {
      setInternalPath(null);
      return;
    }
    const current = selectedPath();
    if (!current || !files.some((file) => file.path === current)) {
      const next = files[0]!.path;
      setInternalPath(next);
      props.onSelectPath?.(next);
    }
  });

  const totals = createMemo(() => {
    return props.files.reduce(
      (summary, file) => ({
        additions: summary.additions + file.additions,
        deletions: summary.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
  });

  function select(path: string): void {
    setInternalPath(path);
    props.onSelectPath?.(path);
  }

  return (
    <div class="diff-view">
      <Show
        when={props.files.length > 0}
        fallback={
          <p class="inspector-empty">
            No working-tree changes yet. Edits from git or tool calls show up here for review.
          </p>
        }
      >
        <div class="diff-overview">
          <span>{props.files.length} files</span>
          <span class="diff-stat">
            <b>+{totals().additions}</b>
            <i>-{totals().deletions}</i>
          </span>
        </div>

        <div class="diff-file-list" role="listbox" aria-label="Changed files">
          <For each={props.files}>
            {(file) => (
              <button
                type="button"
                class="diff-file-row"
                classList={{ "is-selected": selectedFile()?.path === file.path }}
                role="option"
                aria-selected={selectedFile()?.path === file.path}
                onClick={() => select(file.path)}
              >
                <span class={`diff-status diff-status--${file.status}`}>
                  {statusLetter(file.status)}
                </span>
                <span class="diff-file-row__path" title={file.path}>
                  {file.path}
                </span>
                <span class="diff-stat">
                  <Show when={file.additions > 0 || file.deletions > 0} fallback={<em>—</em>}>
                    <b>+{file.additions}</b>
                    <i>-{file.deletions}</i>
                  </Show>
                </span>
              </button>
            )}
          </For>
        </div>

        <Show when={selectedFile()}>
          {(file) => (
            <DiffFileCard
              canDiscard={props.canDiscard}
              discarding={props.discardingPath === file().path}
              file={file()}
              onDiscard={props.onDiscard}
            />
          )}
        </Show>
      </Show>
    </div>
  );
}

function DiffFileCard(props: {
  canDiscard?: boolean;
  discarding: boolean;
  file: DiffFile;
  onDiscard?: (path: string) => void;
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
    window.addEventListener("pointerdown", onPointerDown);
    onCleanup(() => window.removeEventListener("pointerdown", onPointerDown));
  });

  return (
    <section class="diff-file diff-file--detail">
      <div class="file-summary">
        <span>
          <FileCode size={16} />
          <small>{props.file.status}</small>
          <span class="file-summary__path" title={props.file.path}>
            {props.file.path}
          </span>
        </span>
        <div class="file-summary__actions">
          <span class="diff-stat">
            <b>+{props.file.additions}</b>
            <i>-{props.file.deletions}</i>
          </span>
          <Show when={props.canDiscard && props.onDiscard}>
            <div class="review-file-menu">
              <IconButton
                label="File actions"
                size="sm"
                active={menuOpen()}
                disabled={props.discarding}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={15} />
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
                      props.onDiscard?.(props.file.path);
                    }}
                  >
                    <RotateCcw size={13} />
                    {props.discarding ? "Discarding…" : "Discard file…"}
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <Show
        when={!props.file.binary && props.file.hunks.length > 0}
        fallback={
          <p class="inspector-empty diff-file-empty">
            {props.file.binary
              ? "Binary or non-text change — open the file in the workspace to inspect."
              : props.file.status === "deleted"
                ? "File deleted in the working tree."
                : "No textual hunks for this file."}
          </p>
        }
      >
        <div class="diff-hunks">
          <For each={props.file.hunks}>
            {(hunk) => (
              <pre class="code-block" aria-label={`Code diff for ${props.file.path}`}>
                <code>
                  <span class="code-row hunk">
                    <em></em>
                    <em></em>
                    <span>{hunk.header}</span>
                  </span>
                  <For each={hunk.lines}>{(line) => <CodeRow line={line} />}</For>
                </code>
              </pre>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

function CodeRow(props: { line: DiffLine }) {
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
