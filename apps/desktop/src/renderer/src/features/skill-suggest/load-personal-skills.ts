import type { PersonalSkillInfo } from "../../../../shared/desktop-contracts";

/** Load personal PI skills; returns [] on failure (picker still allows free text). */
export async function loadPersonalSkills(): Promise<PersonalSkillInfo[]> {
  try {
    return await window.piDesktop.skills.listPersonal();
  } catch {
    return [];
  }
}

export function filterSkills(
  skills: PersonalSkillInfo[],
  query: string,
  exclude: ReadonlySet<string> | readonly string[] = [],
): PersonalSkillInfo[] {
  const excluded = new Set<string>();
  if (exclude instanceof Set) {
    for (const n of exclude) excluded.add(n.toLowerCase());
  } else {
    for (const n of exclude) excluded.add(n.toLowerCase());
  }
  const q = query.trim().toLowerCase();
  return skills
    .filter((s) => !excluded.has(s.name.toLowerCase()))
    .filter((s) => {
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.slug.toLowerCase().includes(q) ||
        (s.description?.toLowerCase().includes(q) ?? false)
      );
    });
}
