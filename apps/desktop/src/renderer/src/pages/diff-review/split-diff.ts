import type { DiffHunk, DiffLine } from "../agent-workspace/model";

export type SplitSide = {
  content: string;
  kind: DiffLine["kind"] | "empty";
  line?: number;
};

export type SplitRow = {
  id: string;
  left: SplitSide;
  right: SplitSide;
};

/** Pair unified hunk lines into side-by-side rows (remove/add runs align). */
export function splitRowsFromHunk(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  let removes: DiffLine[] = [];
  let adds: DiffLine[] = [];
  let pairIndex = 0;

  const flush = () => {
    const count = Math.max(removes.length, adds.length);
    for (let i = 0; i < count; i += 1) {
      const leftLine = removes[i];
      const rightLine = adds[i];
      rows.push({
        id: `${hunk.id}:pair:${pairIndex++}`,
        left: leftLine
          ? { content: leftLine.content, kind: leftLine.kind, line: leftLine.oldLine }
          : { content: "", kind: "empty" },
        right: rightLine
          ? { content: rightLine.content, kind: rightLine.kind, line: rightLine.newLine }
          : { content: "", kind: "empty" },
      });
    }
    removes = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.kind === "removed") {
      if (adds.length > 0) flush();
      removes.push(line);
      continue;
    }
    if (line.kind === "added") {
      adds.push(line);
      continue;
    }
    flush();
    rows.push({
      id: `${hunk.id}:ctx:${pairIndex++}`,
      left: { content: line.content, kind: "context", line: line.oldLine },
      right: { content: line.content, kind: "context", line: line.newLine },
    });
  }
  flush();
  return rows;
}
