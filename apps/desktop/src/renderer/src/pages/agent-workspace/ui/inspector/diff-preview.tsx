import { FileCode } from "lucide-solid";
import { createMemo, For } from "solid-js";
import type { DiffFile, DiffLine } from "../../model";
import { diffFiles } from "../../model";

export function DiffPreview() {
  const totals = createMemo(() => {
    return diffFiles.reduce((summary, file) => ({
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions
    }), { additions: 0, deletions: 0 });
  });

  return (
    <div class="diff-view">
      <div class="diff-overview">
        <span>{diffFiles.length} files changed</span>
        <span class="diff-stat"><b>+{totals().additions}</b><i>-{totals().deletions}</i></span>
      </div>
      <For each={diffFiles}>
        {(file) => <DiffFileView file={file} />}
      </For>
    </div>
  );
}

function DiffFileView(props: { file: DiffFile }) {
  return (
    <section class="diff-file">
      <FileSummary file={props.file} />
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

function FileSummary(props: { file: DiffFile }) {
  return (
    <div class="file-summary">
      <span><FileCode size={16} /> <small>{props.file.status}</small> {props.file.path}</span>
      <span class="diff-stat"><b>+{props.file.additions}</b><i>-{props.file.deletions}</i></span>
    </div>
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
      <span>{prefix()} {props.line.content}</span>
    </span>
  );
}
