import type { TimelineItem } from "@/features/agent-timeline";

export const EXTRACT_TASK_TITLE_PREFIX = "Extract skill ·";

export type ChatTurn = {
  id: string;
  kind: "user" | "assistant";
  text: string;
  timestamp: number;
};

export function chatTurnsFromItems(items: TimelineItem[]): ChatTurn[] {
  return items
    .filter((item): item is TimelineItem & { kind: "user" | "assistant" } => {
      return (
        (item.kind === "user" || item.kind === "assistant") &&
        typeof item.text === "string" &&
        item.text.trim().length > 0
      );
    })
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      text: item.text.trim(),
      timestamp: item.timestamp,
    }));
}

export function canExtractFromTurns(turns: ChatTurn[]): { ok: true } | { ok: false; reason: string } {
  if (turns.length < 2) {
    return { ok: false, reason: "至少需要一轮用户消息和一轮助手回复，再抽取更稳。" };
  }
  const hasUser = turns.some((turn) => turn.kind === "user");
  const hasAssistant = turns.some((turn) => turn.kind === "assistant");
  if (!hasUser || !hasAssistant) {
    return { ok: false, reason: "需要同时包含用户与助手内容。" };
  }
  const chars = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  if (chars < 120) {
    return { ok: false, reason: "对话太短，先把可复用步骤聊清楚再抽。" };
  }
  return { ok: true };
}

export function sliceTurns(turns: ChatTurn[], fromId: string | null, toId: string | null): ChatTurn[] {
  if (!fromId && !toId) return turns;
  const fromIndex = fromId ? turns.findIndex((turn) => turn.id === fromId) : 0;
  const toIndex = toId ? turns.findIndex((turn) => turn.id === toId) : turns.length - 1;
  if (fromIndex < 0 || toIndex < 0 || fromIndex > toIndex) return turns;
  return turns.slice(fromIndex, toIndex + 1);
}

export function formatTranscript(turns: ChatTurn[]): string {
  return turns
    .map((turn) => `### ${turn.kind === "user" ? "User" : "Assistant"}\n\n${turn.text}`)
    .join("\n\n");
}

export function buildExtractPrompt(transcript: string): string {
  return [
    "你正在帮用户把一次成功的工作流抽取成可复用的 PI Skill。",
    "这是一次**抽取专用**会话：不要继续做原任务，只产出 Skill 草案。",
    "",
    "要求：",
    "1. 输出一个完整的 `SKILL.md`（含 YAML frontmatter：name、description；需要时 disable-model-invocation）。",
    "2. name 用 kebab-case。",
    "3. 正文写清何时用、步骤、输入/输出、必要命令或脚本约定；能脚本化的步骤优先写成可复用命令，而不是要求每次重新探索。",
    "4. 一次性的上下文不要写进 skill。",
    "5. 最终回复里用单个 markdown 代码块包住完整 SKILL.md（语言标记用 markdown）。",
    "6. 代码块前后可有一两句说明；不要写多个互相冲突的 SKILL.md。",
    "",
    "以下是来源对话 transcript：",
    "",
    "-----",
    transcript,
    "-----",
  ].join("\n");
}

export function isExtractTaskTitle(title: string | null | undefined): boolean {
  return Boolean(title?.startsWith(EXTRACT_TASK_TITLE_PREFIX));
}

export type SkillDraft = {
  slug: string;
  skillMd: string;
};

/** Pull the first plausible SKILL.md fenced block (or bare frontmatter doc) from assistant text. */
export function parseSkillDraft(text: string): SkillDraft | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced =
    trimmed.match(/```(?:markdown|md)?\s*\n([\s\S]*?)\n```/i) ??
    trimmed.match(/```\s*\n(---[\s\S]*?)\n```/);
  const body = (fenced?.[1] ?? trimmed).trim();
  if (!body.startsWith("---")) return null;

  const nameMatch = body.match(/^---\s*[\s\S]*?^name:\s*['"]?([a-zA-Z0-9._-]+)/m);
  if (!nameMatch?.[1]) return null;
  const slug = nameMatch[1]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  return { slug, skillMd: body.endsWith("\n") ? body : `${body}\n` };
}

export function latestAssistantSkillDraft(items: TimelineItem[]): SkillDraft | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "assistant") continue;
    const draft = parseSkillDraft(item.text);
    if (draft) return draft;
  }
  return null;
}
