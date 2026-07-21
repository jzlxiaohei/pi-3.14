import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { WorkspaceListResult } from "../../shared/pi-ipc";

const IGNORED = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  "dist",
  "out",
  ".next",
  "coverage",
]);

export async function listWorkspaceChildren(
  cwd: string,
  relativePath = "",
): Promise<WorkspaceListResult> {
  const root = resolve(cwd);
  const target = resolve(root, relativePath || ".");
  assertInsideRoot(root, target);

  const entries = await readdir(target, { withFileTypes: true });
  const children = entries
    .filter((entry) => !IGNORED.has(entry.name) && !entry.name.startsWith("."))
    .map((entry) => {
      const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      return {
        name: entry.name,
        path: childRel.replaceAll("\\", "/"),
        type: entry.isDirectory() ? ("folder" as const) : ("file" as const),
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  return {
    cwd: root,
    path: relativePath.replaceAll("\\", "/"),
    entries: children,
  };
}

function assertInsideRoot(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "..") {
    throw new Error("Path escapes workspace root");
  }
}
