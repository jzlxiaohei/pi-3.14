import { ArrowRight, Code2, FolderOpen, Shield, ShieldOff, Square, Undo2 } from "lucide-solid";
import type { JSX } from "solid-js";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { IconButton } from "@/shared/ui/icon-button";
import { Select, type SelectOption } from "@/shared/ui/select";

const COMPOSER_MIN_HEIGHT = 48;
const COMPOSER_MAX_HEIGHT = 200;
const SLASH_MENU_LIMIT = 12;

export type ComposerSkillOption = {
  name: string;
  description?: string;
};

type ComposerProps = {
  /** Increment when draft is programmatically prefilled — triggers attention motion. */
  attentionKey?: number;
  /** Session tool policy: false = Ask, true = Auto this chat. */
  autoApproveUnlocked?: boolean;
  disabled?: boolean;
  modelLabel: string;
  modelOptions: SelectOption[];
  modelValue: string | null;
  /** Abort in-flight turn; keep leaf on the current path. */
  onStop: () => void;
  /** Abort and drop incomplete assistant path when model output exists. */
  onRevert: () => void;
  onAutoApproveChange?: (unlocked: boolean) => void;
  onInput: (value: string) => void;
  onModelChange: (value: string) => void;
  onSelectWorkspace: () => void;
  onSubmit: () => void;
  onThinkingChange: (value: string) => void;
  /** Active PI skills for `/` slash completion (name matches PI skill slug). */
  skills?: ComposerSkillOption[];
  streaming?: boolean;
  thinkingLevel: string;
  thinkingOptions: SelectOption[];
  thinkingValue: string | null;
  toolbarHud?: JSX.Element;
  toolbarAction?: JSX.Element;
  value: string;
  workspaceLabel: string;
  workspaceTitle?: string;
};

type SlashQuery = {
  /** Full token including leading `/`, e.g. `/grill`. */
  token: string;
  /** Text after `/` used for filtering. */
  filter: string;
  /** Start index of `/` in the full draft. */
  start: number;
  /** End index (exclusive) of the slash token — usually caret. */
  end: number;
};

export function Composer(props: ComposerProps) {
  const canSend = () => !props.disabled && !props.streaming && props.value.trim().length > 0;
  const [attention, setAttention] = createSignal(false);
  const [caret, setCaret] = createSignal(0);
  const [menuIndex, setMenuIndex] = createSignal(0);
  /** Escape dismisses until the slash token ends. */
  const [slashDismissed, setSlashDismissed] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  function autoGrow() {
    const el = textareaRef;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT)}px`;
  }

  // Grow/shrink when the value changes from any source (typing, send-clear, suggestions).
  createEffect(() => {
    props.value;
    autoGrow();
  });

  createEffect(() => {
    const key = props.attentionKey ?? 0;
    if (key <= 0) return;

    setAttention(true);
    queueMicrotask(() => {
      const el = textareaRef;
      if (!el || el.disabled) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
      setCaret(len);
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

    const timer = window.setTimeout(() => setAttention(false), 320);
    onCleanup(() => {
      window.clearTimeout(timer);
      setAttention(false);
    });
  });

  function syncCaretFromDom() {
    const el = textareaRef;
    if (!el) return;
    setCaret(el.selectionStart ?? el.value.length);
  }

  const slashQuery = createMemo((): SlashQuery | null => {
    if (props.disabled || props.streaming) return null;
    return parseSlashQuery(props.value, caret());
  });

  const skillMatches = createMemo(() => {
    const query = slashQuery();
    if (!query) return [] as ComposerSkillOption[];
    const skills = props.skills ?? [];
    const filter = query.filter.toLowerCase();
    const ranked = skills
      .filter((skill) => {
        if (!filter) return true;
        const name = skill.name.toLowerCase();
        const desc = (skill.description ?? "").toLowerCase();
        return name.includes(filter) || desc.includes(filter);
      })
      .sort((a, b) => {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        const aStarts = an.startsWith(filter) ? 0 : 1;
        const bStarts = bn.startsWith(filter) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return an.localeCompare(bn);
      });
    return ranked.slice(0, SLASH_MENU_LIMIT);
  });

  const menuOpen = createMemo(() => slashQuery() != null && !slashDismissed());

  createEffect(() => {
    // Reset highlight when the filtered list changes.
    slashQuery();
    skillMatches();
    setMenuIndex(0);
  });

  createEffect(() => {
    // Re-enable the menu once the user leaves the slash token.
    if (!slashQuery()) setSlashDismissed(false);
  });

  function applySkill(skill: ComposerSkillOption) {
    const query = slashQuery();
    if (!query) return;
    const before = props.value.slice(0, query.start);
    const after = props.value.slice(query.end);
    // Keep a trailing space so the user can keep typing the prompt body.
    const insert = `/${skill.name} `;
    const next = `${before}${insert}${after}`;
    const nextCaret = before.length + insert.length;
    props.onInput(next);
    queueMicrotask(() => {
      const el = textareaRef;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
      autoGrow();
    });
  }

  function submit() {
    if (!canSend()) return;
    props.onSubmit();
  }

  function onKeyDown(event: KeyboardEvent) {
    const open = menuOpen();
    const matches = skillMatches();

    if (open && matches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMenuIndex((index) => (index + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMenuIndex((index) => (index - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
        event.preventDefault();
        const pick = matches[menuIndex()] ?? matches[0];
        if (pick) applySkill(pick);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashDismissed(true);
        return;
      }
    }

    // Chat convention: Enter sends, Shift+Enter inserts a newline.
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    submit();
  }

  return (
    <div class="at-composer-wrap">
      <div class="at-composer" data-attention={attention() ? "true" : undefined}>
        <Show when={menuOpen()}>
          <div class="at-slash-menu" role="listbox" aria-label="Skill suggestions">
            <Show
              when={(props.skills?.length ?? 0) > 0}
              fallback={
                <div class="at-slash-menu__empty">
                  暂无可用 skill（确认 session 已 ready，且项目/个人 skills 已加载）
                </div>
              }
            >
              <Show
                when={skillMatches().length > 0}
                fallback={<div class="at-slash-menu__empty">没有匹配的 skill</div>}
              >
                <For each={skillMatches()}>
                  {(skill, index) => (
                    <button
                      type="button"
                      class="at-slash-menu__item"
                      role="option"
                      aria-selected={index() === menuIndex() ? "true" : "false"}
                      data-active={index() === menuIndex() ? "true" : undefined}
                      onMouseEnter={() => setMenuIndex(index())}
                      onMouseDown={(event) => {
                        // Keep focus in the textarea.
                        event.preventDefault();
                        applySkill(skill);
                      }}
                    >
                      <span class="at-slash-menu__name">/{skill.name}</span>
                      <Show when={skill.description}>
                        {(description) => (
                          <span class="at-slash-menu__desc">{description()}</span>
                        )}
                      </Show>
                    </button>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </Show>
        <textarea
          ref={textareaRef}
          value={props.value}
          disabled={props.disabled || props.streaming}
          onInput={(event) => {
            props.onInput(event.currentTarget.value);
            setCaret(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
          }}
          onClick={syncCaretFromDom}
          onKeyUp={syncCaretFromDom}
          onSelect={syncCaretFromDom}
          onKeyDown={onKeyDown}
          placeholder="Ask PI…  输入 / 选择 skill"
        />
        <div class="at-composer-toolbar">
          <div class="at-composer-toolbar__left">
            <button
              class="at-context-pill"
              type="button"
              disabled={props.disabled}
              title={props.workspaceTitle ?? props.workspaceLabel}
              onClick={props.onSelectWorkspace}
            >
              <FolderOpen size={14} /> {props.workspaceLabel}
            </button>
            <Show
              when={props.thinkingOptions.length > 0}
              fallback={
                <span class="at-context-pill at-context-pill--static">
                  <Code2 size={14} /> {props.thinkingLevel}
                </span>
              }
            >
              <Select
                class="at-composer-select"
                disabled={props.disabled || props.streaming}
                options={props.thinkingOptions}
                placeholder="thinking"
                value={props.thinkingValue}
                onValueChange={props.onThinkingChange}
              />
            </Show>
            <Show when={props.onAutoApproveChange}>
              <button
                class="at-context-pill at-permission-toggle"
                type="button"
                disabled={props.disabled || props.streaming}
                data-mode={props.autoApproveUnlocked ? "auto" : "ask"}
                title={
                  props.autoApproveUnlocked
                    ? "Auto this chat — ask-tier tools run without prompting (destructive rm still blocked)"
                    : "Ask — prompt before edit/write and risky bash"
                }
                onClick={() => props.onAutoApproveChange?.(!props.autoApproveUnlocked)}
              >
                <Show
                  when={props.autoApproveUnlocked}
                  fallback={
                    <>
                      <Shield size={14} /> Ask
                    </>
                  }
                >
                  <ShieldOff size={14} /> Auto
                </Show>
              </button>
            </Show>
          </div>
          <Show when={props.toolbarHud}>
            <div class="at-composer-toolbar__hud">{props.toolbarHud}</div>
          </Show>
          <div class="at-composer-toolbar__right">
            {props.toolbarAction}
            <Show
              when={props.modelOptions.length > 0}
              fallback={<span class="at-model-pill">{props.modelLabel}</span>}
            >
              <Select
                class="at-composer-select at-composer-select--model"
                disabled={props.disabled || props.streaming}
                options={props.modelOptions}
                placeholder="model"
                value={props.modelValue}
                onValueChange={props.onModelChange}
              />
            </Show>
            <Show
              when={props.streaming}
              fallback={
                <IconButton
                  label="Send message"
                  size="sm"
                  variant="primary"
                  disabled={!canSend()}
                  onClick={submit}
                >
                  <ArrowRight size={15} />
                </IconButton>
              }
            >
              <IconButton label="Stop" size="sm" onClick={props.onStop}>
                <Square size={13} fill="currentColor" />
              </IconButton>
              <IconButton label="Revert" size="sm" variant="danger" onClick={props.onRevert}>
                <Undo2 size={14} />
              </IconButton>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Slash token immediately before the caret (start of line or after whitespace). */
export function parseSlashQuery(value: string, caret: number): SlashQuery | null {
  const end = Math.max(0, Math.min(caret, value.length));
  const before = value.slice(0, end);
  const match = before.match(/(?:^|[\s\n])(\/[a-zA-Z0-9._-]*)$/);
  if (!match) return null;
  const token = match[1] ?? "";
  if (!token.startsWith("/")) return null;
  const start = end - token.length;
  return {
    token,
    filter: token.slice(1),
    start,
    end,
  };
}
