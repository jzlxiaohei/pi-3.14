import { execFile } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  WorkspaceInstallMattSkillsRequest,
  WorkspaceInstallMattSkillsResult,
  WorkspaceMattSkillsStatus,
  WorkspaceMattSkillsStatusRequest,
} from "../../shared/desktop-contracts";

const execFileAsync = promisify(execFile);

const MATT_SKILLS_REPO = "https://github.com/mattpocock/skills.git";
const ENGINEERING_REL = join("skills", "engineering");

/** Skills our first-slice playbooks + setup depend on. */
const REQUIRED_MATT_SKILLS = [
  "setup-matt-pocock-skills",
  "grill-with-docs",
  "to-spec",
  "implement",
  "tdd",
  "code-review",
  "diagnosing-bugs",
] as const;

/**
 * Clone Matt engineering skills into `{cwd}/.pi/skills` and mark the project trusted
 * so PI will load project-local resources under `.pi/`.
 */
export async function installMattSkills(
  request: WorkspaceInstallMattSkillsRequest,
): Promise<WorkspaceInstallMattSkillsResult> {
  const cwd = resolve(request.cwd);
  if (!existsSync(cwd)) {
    return { ok: false, error: `Workspace not found: ${cwd}` };
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "pie-matt-skills-"));
  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--single-branch", MATT_SKILLS_REPO, tempRoot],
      { timeout: 120_000 },
    );

    const sourceRoot = join(tempRoot, ENGINEERING_REL);
    if (!existsSync(sourceRoot)) {
      return { ok: false, error: `Repo missing ${ENGINEERING_REL}` };
    }

    const skillNames = readdirSync(sourceRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    if (skillNames.length === 0) {
      return { ok: false, error: "No engineering skill folders found upstream" };
    }

    const skillsDir = join(cwd, ".pi", "skills");
    mkdirSync(skillsDir, { recursive: true });

    for (const name of skillNames) {
      const from = join(sourceRoot, name);
      const to = join(skillsDir, name);
      rmSync(to, { recursive: true, force: true });
      cpSync(from, to, { recursive: true });
    }

    const trusted = markProjectTrusted(cwd);

    return { ok: true, skillsDir, skillNames, trusted };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

/** Disk truth for “Matt skills already installed in this project”. */
export function readMattSkillsStatus(
  request: WorkspaceMattSkillsStatusRequest,
): WorkspaceMattSkillsStatus {
  const cwd = resolve(request.cwd);
  const skillsDir = join(cwd, ".pi", "skills");
  const skillNames = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(skillsDir, entry.name, "SKILL.md")))
        .map((entry) => entry.name)
        .sort()
    : [];
  const present = new Set(skillNames);
  const missing = REQUIRED_MATT_SKILLS.filter((name) => !present.has(name));
  const installed = missing.length === 0;
  const setup = readMattSetupStatus(cwd, skillNames);
  return {
    cwd,
    skillsDir,
    installed,
    skillNames,
    missing: [...missing],
    setupComplete: installed && setup.setupComplete,
    setupMissing: setup.setupMissing,
  };
}

/**
 * Heuristic for `/setup-matt-pocock-skills` completion — the skill writes these
 * files after the Q&A; other engineering skills also gate on issue-tracker.md.
 */
function readMattSetupStatus(
  cwd: string,
  skillNames: string[],
): { setupComplete: boolean; setupMissing: string[] } {
  const setupMissing: string[] = [];
  const agentsDir = join(cwd, "docs", "agents");
  if (!existsSync(join(agentsDir, "issue-tracker.md"))) {
    setupMissing.push("docs/agents/issue-tracker.md");
  }
  if (!existsSync(join(agentsDir, "domain.md"))) {
    setupMissing.push("docs/agents/domain.md");
  }
  if (skillNames.includes("triage") && !existsSync(join(agentsDir, "triage-labels.md"))) {
    setupMissing.push("docs/agents/triage-labels.md");
  }

  const hasAgentSkillsBlock = ["CLAUDE.md", "AGENTS.md"].some((name) => {
    const path = join(cwd, name);
    if (!existsSync(path)) return false;
    try {
      return /^## Agent skills\s*$/m.test(readFileSync(path, "utf-8"));
    } catch {
      return false;
    }
  });
  if (!hasAgentSkillsBlock) {
    setupMissing.push("## Agent skills (CLAUDE.md / AGENTS.md)");
  }

  return { setupComplete: setupMissing.length === 0, setupMissing };
}

/** Persist cwd → true in PI's project trust store (same file the CLI uses). */
function markProjectTrusted(cwd: string): boolean {
  const trustFile = join(homedir(), ".pi", "agent", "trust.json");
  mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });

  let data: Record<string, boolean | null> = {};
  if (existsSync(trustFile)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(trustFile, "utf-8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, boolean | null>;
      }
    } catch {
      data = {};
    }
  }

  data[cwd] = true;
  const sorted: Record<string, boolean | null> = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = data[key] ?? null;
  }
  writeFileSync(trustFile, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
  return true;
}
