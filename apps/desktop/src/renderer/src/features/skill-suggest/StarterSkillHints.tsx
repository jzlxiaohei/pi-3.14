import type { PersonalSkillInfo } from "../../../../shared/desktop-contracts";
import { For, Show, createMemo, createSignal } from "solid-js";
import { filterSkills } from "./load-personal-skills";

type StarterSkillHintsProps = {
  skills: PersonalSkillInfo[];
  loading?: boolean;
  /** Current starter text — used to filter chips by trailing `/token`. */
  starterValue: string;
  onInsert: (slashCommand: string) => void;
};

/**
 * Path step Starter: show personal skills as insertable `/name` chips.
 * Filters by the incomplete `/token` at the end of the starter when present.
 */
export function StarterSkillHints(props: StarterSkillHintsProps) {
  const [expanded, setExpanded] = createSignal(false);

  const trailingToken = createMemo(() => {
    const text = props.starterValue;
    const match = text.match(/(?:^|\n)\s*\/([a-zA-Z0-9][a-zA-Z0-9._-]*)?$/);
    if (!match) return null;
    return match[1] ?? "";
  });

  const chips = createMemo(() => {
    const token = trailingToken();
    const query = token === null ? "" : token;
    const list = filterSkills(props.skills, query);
    if (expanded() || token !== null) return list.slice(0, 16);
    return list.slice(0, 8);
  });

  const moreCount = createMemo(() => {
    if (expanded() || trailingToken() !== null) return 0;
    const total = filterSkills(props.skills, "").length;
    return Math.max(0, total - 8);
  });

  return (
    <div class="starter-skill-hints">
      <div class="starter-skill-hints__label">
        <span>插入 skill</span>
        <Show
          when={!props.loading && props.skills.length > 0}
          fallback={
            <span class="starter-skill-hints__muted">
              {props.loading
                ? "加载中…"
                : "本机暂无 skill；可手写 /skill-name（非强制挂载）"}
            </span>
          }
        >
          <span class="starter-skill-hints__muted">
            点击插入 <code>/name</code>
            {trailingToken() !== null ? " · 已按当前 / 前缀过滤" : ""}
          </span>
        </Show>
      </div>
      <Show when={props.skills.length > 0}>
        <div class="starter-skill-hints__chips">
          <For each={chips()}>
            {(skill) => (
              <button
                type="button"
                class="starter-skill-hints__chip"
                title={skill.description ?? skill.name}
                onClick={() => props.onInsert(`/${skill.name}`)}
              >
                /{skill.name}
              </button>
            )}
          </For>
          <Show when={moreCount() > 0}>
            <button
              type="button"
              class="starter-skill-hints__chip starter-skill-hints__chip--more"
              onClick={() => setExpanded(true)}
            >
              +{moreCount()} more
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

/** Insert or complete a trailing `/token` in starter text. */
export function insertStarterSlashCommand(text: string, slashCommand: string): string {
  const cmd = slashCommand.startsWith("/") ? slashCommand : `/${slashCommand}`;
  const match = text.match(/((?:^|\n)\s*)\/[a-zA-Z0-9._-]*$/);
  if (match && match.index !== undefined) {
    const prefix = text.slice(0, match.index) + (match[1] ?? "");
    return `${prefix}${cmd}`;
  }
  if (!text.trim()) return `${cmd}\n\n`;
  if (text.endsWith("\n")) return `${text}${cmd}`;
  return `${text}\n${cmd}`;
}
