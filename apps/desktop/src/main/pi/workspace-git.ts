import { execFile } from "node:child_process";
import { shell } from "electron";
import path from "node:path";
import { promisify } from "node:util";
import type {
  WorkspaceGitDiscardRequest,
  WorkspaceGitDiscardResult,
  WorkspaceGitFile,
  WorkspaceGitRequest,
  WorkspaceGitSnapshot,
} from "../../shared/desktop-contracts";

const execFileAsync = promisify(execFile);
const MAX_PATCH_CHARS = 400_000;
const MAX_UNTRACKED_FILES = 40;
const MAX_UNTRACKED_FILE_CHARS = 80_000;

export async function readWorkspaceGit(
  request: string | WorkspaceGitRequest,
): Promise<WorkspaceGitSnapshot> {
  const cwd = typeof request === "string" ? request : request.cwd;
  // undefined → HEAD; null → auto default branch; string → explicit ref
  const requestedBase =
    typeof request === "string" ? undefined : "baseRef" in request ? request.baseRef : undefined;

  const inside = await git(cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (inside.trim() !== "true") {
    return {
      isRepo: false,
      branch: null,
      upstream: null,
      baseRef: "HEAD",
      bases: ["HEAD"],
      files: [],
      patch: null,
    };
  }

  const [branch, upstream, allBases] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "HEAD"),
    git(cwd, ["rev-parse", "--abbrev-ref", "@{upstream}"]).catch(() => ""),
    listBaseRefs(cwd).catch(() => ["HEAD"] as string[]),
  ]);
  const branchName = branch.trim() || null;
  const upstreamRef = upstream.trim() || null;
  // Compare targets: skip current branch + its remote (usually same tip as HEAD).
  const bases = filterCompareBases(allBases, branchName, upstreamRef);
  const baseRef = await resolveBaseRef(cwd, requestedBase, bases);

  const untrackedPaths = await listUntrackedFiles(cwd).catch(() => [] as string[]);
  const useHeadStatus = baseRef === "HEAD";

  const [statusFiles, trackedPatch] = await Promise.all([
    useHeadStatus
      ? git(cwd, ["status", "--porcelain"])
          .then(parsePorcelain)
          .catch(() => [] as WorkspaceGitFile[])
      : gitDiff(cwd, ["diff", "--name-status", baseRef])
          .then(parseNameStatus)
          .catch(() => [] as WorkspaceGitFile[]),
    gitDiff(cwd, ["diff", baseRef]).catch(() => ""),
  ]);

  const files = expandUntrackedEntries(statusFiles, untrackedPaths);
  const untrackedPatch = await buildUntrackedPatch(cwd, untrackedPaths);
  const patch = joinPatches(trackedPatch, untrackedPatch);
  const truncated =
    patch.length > MAX_PATCH_CHARS ? `${patch.slice(0, MAX_PATCH_CHARS)}\n…(truncated)` : patch;

  return {
    isRepo: true,
    branch: branch.trim() || null,
    upstream: upstreamRef,
    baseRef,
    bases,
    files,
    patch: truncated.trim() ? truncated : null,
  };
}

export async function discardWorkspaceGitFile(
  request: WorkspaceGitDiscardRequest,
): Promise<WorkspaceGitDiscardResult> {
  const relative = normalizeRelativePath(request.path);
  if (!relative) {
    return { ok: false, error: "Invalid path" };
  }

  const inside = await git(request.cwd, ["rev-parse", "--is-inside-work-tree"]).catch(() => "");
  if (inside.trim() !== "true") {
    return { ok: false, error: "Not a git repository" };
  }

  const porcelain = await git(request.cwd, ["status", "--porcelain", "--", relative]).catch(() => "");
  const statusEntries = parsePorcelain(porcelain);
  const exact = statusEntries.find((file) => file.path === relative);
  const untrackedFiles = await listUntrackedFiles(request.cwd).catch(() => [] as string[]);
  const isUntracked =
    exact?.status === "untracked" ||
    untrackedFiles.includes(relative) ||
    statusEntries.some((file) => {
      if (file.status !== "untracked") return false;
      if (relative === file.path) return true;
      const prefix = file.path.endsWith("/") ? file.path : `${file.path}/`;
      return relative.startsWith(prefix);
    });

  if (!exact && !isUntracked && statusEntries.length === 0) {
    return { ok: false, error: "File is not changed in the working tree" };
  }

  try {
    if (isUntracked) {
      await shell.trashItem(path.resolve(request.cwd, relative));
    } else {
      // Drop staged + unstaged changes for this path (including staged new files).
      await git(request.cwd, [
        "restore",
        "--source=HEAD",
        "--staged",
        "--worktree",
        "--",
        relative,
      ]);
    }
    return { ok: true, path: relative };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function listBaseRefs(cwd: string): Promise<string[]> {
  const output = await git(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes",
  ]);
  const refs = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && line !== "origin/HEAD");
  return sortBaseRefs(["HEAD", ...refs]);
}

async function resolveBaseRef(
  cwd: string,
  requested: string | null | undefined,
  bases: string[],
): Promise<string> {
  if (requested === undefined) return "HEAD";
  // Ignore stale picks (e.g. current branch) that are no longer offered.
  if (requested && bases.includes(requested) && (await isCommitRef(cwd, requested))) {
    return requested;
  }

  const preferred = ["main", "master", "origin/main", "origin/master"];
  for (const name of preferred) {
    if (bases.includes(name) && (await isCommitRef(cwd, name))) return name;
  }
  return "HEAD";
}

/** Drop current branch / upstream — comparing working tree to them is rarely useful. */
function filterCompareBases(
  bases: string[],
  branch: string | null,
  upstream: string | null,
): string[] {
  const skip = new Set<string>();
  if (branch && branch !== "HEAD") {
    skip.add(branch);
    skip.add(`origin/${branch}`);
  }
  if (upstream) skip.add(upstream);
  return bases.filter((ref) => !skip.has(ref));
}

async function isCommitRef(cwd: string, ref: string): Promise<boolean> {
  if (!ref || ref.includes("..") || ref.includes("\0")) return false;
  const out = await git(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]).catch(() => "");
  return Boolean(out.trim());
}

function sortBaseRefs(refs: string[]): string[] {
  const rank = (ref: string): number => {
    if (ref === "HEAD") return 0;
    if (ref === "main" || ref === "master") return 1;
    if (ref === "origin/main" || ref === "origin/master") return 2;
    if (!ref.includes("/")) return 3;
    return 4;
  };
  return [...new Set(refs)].sort((a, b) => {
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

async function listUntrackedFiles(cwd: string): Promise<string[]> {
  const output = await git(cwd, ["ls-files", "-o", "--exclude-standard"]);
  return output
    .split("\n")
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

/** Porcelain may report `?? dir/`; expand to per-file untracked entries for review. */
function expandUntrackedEntries(
  files: WorkspaceGitFile[],
  untrackedPaths: string[],
): WorkspaceGitFile[] {
  const tracked = files.filter((file) => file.status !== "untracked");
  const seen = new Set(tracked.map((file) => file.path));
  const expanded = untrackedPaths
    .filter((filePath) => !seen.has(filePath))
    .map((filePath) => ({ path: filePath, status: "untracked" as const }));
  return [...tracked, ...expanded];
}

async function buildUntrackedPatch(cwd: string, paths: string[]): Promise<string> {
  const chunks: string[] = [];
  let used = 0;
  for (const filePath of paths.slice(0, MAX_UNTRACKED_FILES)) {
    if (used >= MAX_PATCH_CHARS) break;
    const chunk = await gitDiff(cwd, [
      "diff",
      "--no-index",
      "--",
      "/dev/null",
      filePath,
    ]).catch(() => "");
    if (!chunk.trim()) continue;
    const next =
      chunk.length > MAX_UNTRACKED_FILE_CHARS
        ? `${chunk.slice(0, MAX_UNTRACKED_FILE_CHARS)}\n…(truncated)`
        : chunk;
    chunks.push(next.trimEnd());
    used += next.length;
  }
  return chunks.join("\n");
}

function joinPatches(...parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
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

/** `git diff` / `--no-index` may exit 1 when a patch exists. */
async function gitDiff(cwd: string, args: string[]): Promise<string> {
  try {
    return await git(cwd, args);
  } catch (error) {
    const err = error as { code?: number; stdout?: string };
    if (err.code === 1 && typeof err.stdout === "string") return err.stdout;
    throw error;
  }
}

function parsePorcelain(output: string): WorkspaceGitFile[] {
  const files: WorkspaceGitFile[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 3) continue;
    const code = line.slice(0, 2);
    const rest = line.slice(3);
    const filePath = rest.includes(" -> ") ? rest.split(" -> ").at(-1)! : rest;
    files.push({
      path: filePath.replaceAll("\\", "/"),
      status: mapStatus(code),
    });
  }
  return files;
}

function parseNameStatus(output: string): WorkspaceGitFile[] {
  const files: WorkspaceGitFile[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const filePath = (parts.length >= 3 ? parts[2] : parts[1])?.replaceAll("\\", "/") ?? "";
    if (!filePath) continue;
    files.push({
      path: filePath,
      status: mapNameStatus(code),
    });
  }
  return files;
}

function mapNameStatus(code: string): WorkspaceGitFile["status"] {
  const kind = code.charAt(0);
  if (kind === "A") return "added";
  if (kind === "D") return "deleted";
  if (kind === "R" || kind === "C") return "renamed";
  return "modified";
}

function mapStatus(code: string): WorkspaceGitFile["status"] {
  if (code === "??") return "untracked";
  if (code.includes("D")) return "deleted";
  if (code.includes("A")) return "added";
  if (code.includes("R")) return "renamed";
  return "modified";
}

function normalizeRelativePath(value: string): string | null {
  const normalized = value.replaceAll("\\", "/").trim();
  if (!normalized || path.isAbsolute(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "")) return null;
  return parts.join("/");
}
