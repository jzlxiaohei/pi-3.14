import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  PersonalSkillInfo,
  PersonalSkillWriteRequest,
  PersonalSkillWriteResult,
} from "../../shared/desktop-contracts";

/** PI personal agent skills root — interop with CLI / default createAgentSession. */
export function personalSkillsDir(): string {
  return join(homedir(), ".pi", "agent", "skills");
}

/**
 * Catalog of skills under `~/.pi/agent/skills` for Templates / Paths pickers.
 * Name prefers YAML frontmatter `name:`; falls back to folder slug.
 */
export function listPersonalSkills(): PersonalSkillInfo[] {
  const root = personalSkillsDir();
  if (!existsSync(root)) return [];

  const out: PersonalSkillInfo[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillPath = join(root, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    let body = "";
    try {
      body = readFileSync(skillPath, "utf-8");
    } catch {
      continue;
    }
    const meta = parseSkillFrontmatter(body);
    const name = (meta.name ?? entry.name).trim();
    if (!name) continue;
    out.push({
      name,
      description: meta.description?.trim() || undefined,
      slug: entry.name,
      skillPath,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function parseSkillFrontmatter(body: string): { name?: string; description?: string } {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const block = match[1] ?? "";
  let name: string | undefined;
  let description: string | undefined;
  for (const line of block.split(/\r?\n/)) {
    const nameHit = line.match(/^name:\s*(.+?)\s*$/);
    if (nameHit) {
      name = stripYamlScalar(nameHit[1] ?? "");
      continue;
    }
    const descHit = line.match(/^description:\s*(.+?)\s*$/);
    if (descHit) {
      description = stripYamlScalar(descHit[1] ?? "");
    }
  }
  return { name, description };
}

function stripYamlScalar(raw: string): string {
  const t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function writePersonalSkill(request: PersonalSkillWriteRequest): PersonalSkillWriteResult {
  const slug = normalizeSkillSlug(request.slug);
  if (!slug) {
    return { ok: false, error: "Skill folder name is invalid (use kebab-case)" };
  }
  const skillMd = request.skillMd.trim();
  if (!skillMd) {
    return { ok: false, error: "SKILL.md content is empty" };
  }
  if (!skillMd.includes("---") || !/name:\s*\S+/.test(skillMd)) {
    return { ok: false, error: "SKILL.md should include YAML frontmatter with a name field" };
  }

  const dir = join(personalSkillsDir(), slug);
  if (existsSync(dir) && !request.overwrite) {
    return { ok: false, error: `Skill already exists: ${slug} (enable overwrite to replace)` };
  }

  mkdirSync(dir, { recursive: true });
  const skillPath = join(dir, "SKILL.md");
  writeFileSync(skillPath, skillMd.endsWith("\n") ? skillMd : `${skillMd}\n`, "utf-8");
  return { ok: true, slug, skillPath, skillsDir: personalSkillsDir() };
}

function normalizeSkillSlug(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug.length > 64) return null;
  return slug;
}
