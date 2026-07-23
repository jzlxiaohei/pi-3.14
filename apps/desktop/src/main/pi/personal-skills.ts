import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  PersonalSkillWriteRequest,
  PersonalSkillWriteResult,
} from "../../shared/desktop-contracts";

/** PI personal agent skills root — interop with CLI / default createAgentSession. */
export function personalSkillsDir(): string {
  return join(homedir(), ".pi", "agent", "skills");
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
