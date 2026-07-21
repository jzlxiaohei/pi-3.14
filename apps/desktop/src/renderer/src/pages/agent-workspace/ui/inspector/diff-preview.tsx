import { FileCode } from "lucide-solid";
import { createMemo, For, Show } from "solid-js";
import type { DiffFile, DiffLine } from "../../model";

type DiffPreviewProps = {
  files: DiffFile[];
};

export function DiffPreview(props: DiffPreviewProps) {
  const totals = createMemo(() => {
    return props.files.reduce(
      (summary, file) => ({
        additions: summary.additions + file.additions,
        deletions: summary.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
  });

  return (
    <div class="diff-view">
      <Show
        when={props.files.length > 0}
        fallback={<p class="inspector-empty">No working-tree or session patches yet. Edits from git or tool calls show up here.</p>}
      >
        <div class="diff-overview">
          <span>{props.files.length} files changed</span>
          <span class="diff-stat"><b>+{totals().additions}</b><i>-{totals().deletions}</i></span>
        </div>
        <For each={props.files}>
          {(file) => <DiffFileView file={file} />}
        </For>
      </Show>
    </div>
  );
}

function DiffFileView(props: { file: DiffFile }) {
  return (
    <section class="diff-file">
      <div class="file-summary">
        <span><FileCode size={16} /> <small>{props.file.status}</small> {props.file.path}</span>
        <span class="diff-stat"><b>+{props.file.additions}</b><i>-{props.file.deletions}</i></span>
      </div>
      <For each={props.file.hunks}>
        {(hunk) => (
          <pre class="code-block" aria-label={`Code diff for ${props.file.path}`}>
            <code>
              <span class="code-row hunk"><em></em><em></em><span>{hunk.header}</span></span>
              <For each={hunk.lines}>
                {(line) => <CodeRow line={line} />}
              </For>
            </code>
          </pre>
        )}
      </For>
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
      <em></em><em></em>
      <span>{prefix()}{props.line.content}</span>
    </span>
  );
}
