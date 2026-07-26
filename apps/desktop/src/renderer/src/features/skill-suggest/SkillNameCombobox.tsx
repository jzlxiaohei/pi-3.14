import type { PersonalSkillInfo } from "../../../../shared/desktop-contracts";
import { For, Show, createMemo, createSignal } from "solid-js";
import { Button } from "@/shared/ui/button";
import { filterSkills } from "./load-personal-skills";

type SkillNameComboboxProps = {
  skills: PersonalSkillInfo[];
  loading?: boolean;
  /** Already-selected names (e.g. ignored list) — hidden from suggestions. */
  exclude?: string[];
  placeholder?: string;
  addLabel?: string;
  emptyCatalogHint?: string;
  onAdd: (name: string) => void;
};

/**
 * Free-text skill name + typeahead from personal catalog.
 * Unknown names still add (soft product path for skills not yet on disk).
 */
export function SkillNameCombobox(props: SkillNameComboboxProps) {
  const [query, setQuery] = createSignal("");
  const [open, setOpen] = createSignal(false);
  const [highlight, setHighlight] = createSignal(0);

  const suggestions = createMemo(() =>
    filterSkills(props.skills, query(), props.exclude ?? []).slice(0, 12),
  );

  const knownNames = createMemo(
    () => new Set(props.skills.map((s) => s.name.toLowerCase())),
  );

  const showUnknownHint = createMemo(() => {
    const name = query().trim();
    if (!name || props.loading) return false;
    if (knownNames().has(name.toLowerCase())) return false;
    if ((props.exclude ?? []).some((e) => e.toLowerCase() === name.toLowerCase())) return false;
    return props.skills.length > 0;
  });

  function commit(name?: string): void {
    const next = (name ?? query()).trim();
    if (!next) return;
    props.onAdd(next);
    setQuery("");
    setHighlight(0);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent): void {
    const list = suggestions();
    if (event.key === "ArrowDown" && list.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlight((i) => (i + 1) % list.length);
      return;
    }
    if (event.key === "ArrowUp" && list.length > 0) {
      event.preventDefault();
      setOpen(true);
      setHighlight((i) => (i - 1 + list.length) % list.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open() && list.length > 0) {
        const pick = list[highlight()] ?? list[0];
        if (pick) commit(pick.name);
        return;
      }
      commit();
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div class="skill-suggest">
      <div class="skill-suggest__row">
        <div class="skill-suggest__field">
          <input
            type="text"
            class="skill-suggest__input"
            placeholder={props.placeholder ?? "技能名称"}
            value={query()}
            autocomplete="off"
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Defer so suggestion mousedown can fire first.
              window.setTimeout(() => setOpen(false), 120);
            }}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setHighlight(0);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          <Show when={open() && (props.loading || suggestions().length > 0 || props.skills.length === 0)}>
            <ul class="skill-suggest__menu" role="listbox">
              <Show when={props.loading}>
                <li class="skill-suggest__empty">加载本机 skill…</li>
              </Show>
              <Show when={!props.loading && props.skills.length === 0}>
                <li class="skill-suggest__empty">
                  {props.emptyCatalogHint ??
                    "本机 ~/.pi/agent/skills 暂无 skill，可直接输入名称添加"}
                </li>
              </Show>
              <Show when={!props.loading && props.skills.length > 0 && suggestions().length === 0}>
                <li class="skill-suggest__empty">无匹配；Enter 仍可添加当前输入</li>
              </Show>
              <For each={suggestions()}>
                {(skill, index) => (
                  <li>
                    <button
                      type="button"
                      class="skill-suggest__option"
                      data-active={highlight() === index() ? "true" : "false"}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlight(index())}
                      onClick={() => commit(skill.name)}
                    >
                      <code>{skill.name}</code>
                      <Show when={skill.description}>
                        <span class="skill-suggest__desc">{skill.description}</span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
        <Button variant="secondary" onClick={() => commit()}>
          {props.addLabel ?? "添加"}
        </Button>
      </div>
      <Show when={showUnknownHint()}>
        <p class="skill-suggest__warn">
          「{query().trim()}」不在本机 skill 目录中，仍可添加（忽略策略按名称匹配）。
        </p>
      </Show>
    </div>
  );
}
