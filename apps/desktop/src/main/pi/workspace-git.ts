import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkspaceGitFile, WorkspaceGitSnapshot } from "../../shared/desktop-contracts";

const execFileAsync = promisify(execFile);
const MAX_PATCH_CHARS = 400_000;

export async function readWorkspaceGit(cwd: string): Promise<WorkspaceGitSnapshot> {
  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (inside.trim() !== "true") {
    return { isRepo: false, branch: null, upstream: null, files: [], patch: null };
  }

  const [branch, upstream, porcelain, patch] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
    git(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]).catch(() => ""),
    git(cwd, ["status", "--porcelain"]).catch(() => ""),
    git(cwd, ["diff", "HEAD"]).catch(() => ""),
  ]);

  const files = parsePorcelain(porcelain);
  const truncated =
    patch.length > MAX_PATCH_CHARS ? `${patch.slice(0, MAX_PATCH_CHARS)}\n…(truncated)` : patch;

  return {
    isRepo: true,
    branch: branch.trim() || null,
    upstream: upstream.trim() || null,
    files,
    patch: truncated.trim() ? truncated : null,
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 15_000,
  });
  return stdout;
}

function parsePorcelain(output: string): WorkspaceGitFile[] {
  const files: WorkspaceGitFile[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 3) continue;
    const code = line.slice(0, 2);
    const rest = line.slice(3);
    const path = rest.includes(" -> ") ? rest.split(" -> ").at(-1)! : rest;
    files.push({
      path: path.replaceAll("\\", "/"),
      status: mapStatus(code),
    });
  }
  return files;
}

function mapStatus(code: string): WorkspaceGitFile["status"] {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("A") || code === "??") return "added";
  if (code.includes("R")) return "renamed";
  return "modified";
}
