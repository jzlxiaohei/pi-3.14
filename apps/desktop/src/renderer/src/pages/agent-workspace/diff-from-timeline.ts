import type { TimelineItem } from "@/features/agent-timeline";
import type { WorkspaceGitFile } from "../../../../shared/desktop-contracts";
import type { DiffFile, DiffHunk, DiffLine } from "./model";

/** Build inspector diffs from committed + overlay tool items that carry patches. */
export function diffFilesFromTimeline(items: TimelineItem[]): DiffFile[] {
  const files: DiffFile[] = [];
  for (const item of items) {
    if (item.kind !== "tool" || !item.diff?.trim()) continue;
    files.push(...parseUnifiedDiff(item.diff, item.id));
  }
  return files;
}

/** Build diffs from a working-tree patch (tracked + untracked). */
export function diffFilesFromGitPatch(patch: string | null | undefined): DiffFile[] {
  if (!patch?.trim()) return [];
  return parseUnifiedDiff(patch, "git-head");
}

/** Prefer working-tree git diffs when paths collide with session tool patches. */
export function mergeDiffFiles(sessionFiles: DiffFile[], gitFiles: DiffFile[]): DiffFile[] {
  const byPath = new Map<string, DiffFile>();
  for (const file of sessionFiles) byPath.set(file.path, file);
  for (const file of gitFiles) byPath.set(file.path, file);
  return [...byPath.values()];
}

/**
 * Merge session + git patches, then ensure every porcelain status path appears
 * (binary / empty / status-only files still show in the review list).
 */
export function mergeReviewDiffFiles(
  sessionFiles: DiffFile[],
  gitFiles: DiffFile[],
  statusFiles: WorkspaceGitFile[],
): DiffFile[] {
  const merged = mergeDiffFiles(sessionFiles, gitFiles);
  const byPath = new Map(merged.map((file) => [file.path, file]));

  for (const status of statusFiles) {
    const existing = byPath.get(status.path);
    if (existing) {
      byPath.set(status.path, {
        ...existing,
        status: mapGitStatus(status.status, existing.status),
      });
      continue;
    }
    byPath.set(status.path, {
      id: `git-status:${status.path}`,
      path: status.path,
      status: mapGitStatus(status.status, "modified"),
      additions: 0,
      deletions: 0,
      hunks: [],
    });
  }

  const statusOrder = new Map(statusFiles.map((file, index) => [file.path, index]));
  return [...byPath.values()].sort((a, b) => {
    const ai = statusOrder.get(a.path) ?? Number.MAX_SAFE_INTEGER;
    const bi = statusOrder.get(b.path) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return a.path.localeCompare(b.path);
  });
}

export function terminalLinesFromTimeline(items: TimelineItem[]): Array<{
  id: string;
  command: string;
  output: string;
  isError: boolean;
}> {
  return items
    .filter((item): item is Extract<TimelineItem, { kind: "tool" }> => item.kind === "tool")
    .filter((item) => isShellTool(item.toolName) && (item.output?.trim() || item.status === "running"))
    .map((item) => ({
      id: item.id,
      command: shellCommand(item.args) || item.detail || item.toolName,
      output: item.output?.trim() || (item.status === "running" ? "Running…" : ""),
      isError: item.status === "error",
    }));
}

function isShellTool(name: string): boolean {
  return name === "bash" || name === "Shell" || name === "shell";
}

function shellCommand(args: unknown): string | null {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
}

function parseUnifiedDiff(diff: string, sourceId: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diff.replace(/\r\n/g, "\n").split("\n");
  let path = "patch";
  let oldPath: string | undefined;
  let hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let additions = 0;
  let deletions = 0;
  let binary = false;

  const flush = () => {
    if (hunks.length === 0 && additions === 0 && deletions === 0 && !binary) return;
    files.push({
      id: `${sourceId}:${path}`,
      path,
      ...(oldPath ? { oldPath } : {}),
      status: pathStatus(oldPath, path, additions, deletions),
      additions,
      deletions,
      hunks,
      ...(binary ? { binary: true } : {}),
    });
    hunks = [];
    current = null;
    additions = 0;
    deletions = 0;
    oldPath = undefined;
    binary = false;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) {
        oldPath = match[1];
        path = match[2] ?? match[1] ?? "patch";
      }
      continue;
    }
    if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      binary = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      const value = line.slice(4).trim();
      if (value !== "/dev/null") oldPath = value.replace(/^a\//, "");
      else oldPath = "/dev/null";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const value = line.slice(4).trim();
      if (value !== "/dev/null") path = value.replace(/^b\//, "");
      continue;
    }
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (hunkHeader) {
      oldLine = Number(hunkHeader[1]);
      newLine = Number(hunkHeader[3]);
      current = {
        id: `${sourceId}:${path}:${hunkHeader[1]}:${hunkHeader[3]}`,
        header: line,
        oldStart: Number(hunkHeader[1]),
        oldLines: Number(hunkHeader[2] ?? "1"),
        newStart: Number(hunkHeader[3]),
        newLines: Number(hunkHeader[4] ?? "1"),
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+")) {
      additions += 1;
      current.lines.push(row(line.slice(1), "added", current.lines.length, undefined, newLine));
      newLine += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
      current.lines.push(row(line.slice(1), "removed", current.lines.length, oldLine, undefined));
      oldLine += 1;
    } else if (line.startsWith(" ") || line === "") {
      current.lines.push(
        row(line.startsWith(" ") ? line.slice(1) : line, "context", current.lines.length, oldLine, newLine),
      );
      oldLine += 1;
      newLine += 1;
    }
  }
  flush();
  return files;
}

function row(
  content: string,
  kind: DiffLine["kind"],
  index: number,
  oldLineNumber?: number,
  newLineNumber?: number,
): DiffLine {
  return {
    id: `${kind}-${index}-${oldLineNumber ?? "x"}-${newLineNumber ?? "x"}-${content.slice(0, 12)}`,
    kind,
    content,
    ...(oldLineNumber !== undefined ? { oldLine: oldLineNumber } : {}),
    ...(newLineNumber !== undefined ? { newLine: newLineNumber } : {}),
  };
}

function pathStatus(
  oldPath: string | undefined,
  path: string,
  additions: number,
  deletions: number,
): DiffFile["status"] {
  if (oldPath === "/dev/null" || (!oldPath && additions > 0 && deletions === 0)) return "added";
  if (path === "/dev/null") return "deleted";
  if (oldPath && oldPath !== path && oldPath !== "/dev/null") return "renamed";
  return "modified";
}

function mapGitStatus(
  gitStatus: WorkspaceGitFile["status"],
  fallback: DiffFile["status"],
): DiffFile["status"] {
  if (gitStatus === "untracked") return "untracked";
  if (gitStatus === "added") return "added";
  if (gitStatus === "deleted") return "deleted";
  if (gitStatus === "renamed") return "renamed";
  if (gitStatus === "modified") return "modified";
  return fallback;
}
