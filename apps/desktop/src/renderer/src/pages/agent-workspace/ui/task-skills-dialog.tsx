import type { PiLiveSkillInfo } from "@pi-3.14/model";
import { LoaderCircle, X } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";

type TaskSkillsDialogProps = {
  disabled?: boolean;
  ignoredSkillNames: string[];
  onOpenChange: (open: boolean) => void;
  onSetIgnoredSkillNames: (names: string[]) => Promise<void> | void;
  open: boolean;
};

export function TaskSkillsDialog(props: TaskSkillsDialogProps) {
  const [loading, setLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [liveSkills, setLiveSkills] = createSignal<PiLiveSkillInfo[]>([]);
  const [knownSkills, setKnownSkills] = createSignal<Record<string, PiLiveSkillInfo>>({});

  createEffect(() => {
    if (!props.open) return;
    void loadSkills();
  });

  const ignoredSet = createMemo(() => new Set(props.ignoredSkillNames));
  const activeSkills = createMemo(() =>
    liveSkills()
      .filter((skill) => !ignoredSet().has(skill.name))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  const ignoredSkills = createMemo(() =>
    props.ignoredSkillNames.map(
      (name) =>
        knownSkills()[name] ?? {
          name,
          description: "Hidden from this task's model prompt.",
          filePath: "",
        },
    ),
  );

  async function loadSkills(options?: { silent?: boolean }): Promise<void> {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const inspect = await window.piDesktop.session.inspect({ detail: "hud" });
      const skills = inspect.live?.skills ?? [];
      setLiveSkills(skills);
      const nextKnown = { ...knownSkills() };
      for (const skill of skills) nextKnown[skill.name] = skill;
      setKnownSkills(nextKnown);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  async function updateIgnored(next: string[]): Promise<void> {
    if (saving() || props.disabled) return;
    setSaving(true);
    setError(null);
    try {
      await props.onSetIgnoredSkillNames(next);
      await loadSkills({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function ignore(skill: PiLiveSkillInfo): void {
    setKnownSkills((prev) => ({ ...prev, [skill.name]: skill }));
    const next = [...props.ignoredSkillNames];
    if (!next.includes(skill.name)) next.push(skill.name);
    void updateIgnored(next);
  }

  function restore(name: string): void {
    void updateIgnored(props.ignoredSkillNames.filter((item) => item !== name));
  }

  return (
    <Dialog
      class="orbit-dialog__content--compact"
      open={props.open}
      title="Task Skills"
      onOpenChange={(open) => {
        if (saving()) return;
        props.onOpenChange(open);
      }}
    >
      <div class="task-skills-dialog">
        <header class="confirm-dialog__header">
          <div>
            <h2>Task Skills</h2>
            <p>Control which skills are advertised to the model for this task.</p>
          </div>
          <IconButton
            label="Close"
            size="sm"
            disabled={saving()}
            onClick={() => props.onOpenChange(false)}
          >
            <X size={14} />
          </IconButton>
        </header>

        <Show when={error()}>
          <p class="task-skills-dialog__error">{error()}</p>
        </Show>

        <Show
          when={!loading()}
          fallback={
            <p class="task-skills-dialog__muted">
              <LoaderCircle class="at-spin" size={13} /> Loading skills…
            </p>
          }
        >
          <section class="task-skills-dialog__section">
            <h3>Active in request ({activeSkills().length})</h3>
            <Show
              when={activeSkills().length > 0}
              fallback={<p class="task-skills-dialog__muted">No active skills loaded.</p>}
            >
              <ul class="task-skills-dialog__list">
                <For each={activeSkills()}>
                  {(skill) => (
                    <li>
                      <div>
                        <strong>{skill.name}</strong>
                        <span>{skill.description || "(no description)"}</span>
                        <Show when={skill.filePath}>
                          <code>{skill.filePath}</code>
                        </Show>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={saving() || props.disabled}
                        onClick={() => ignore(skill)}
                      >
                        Ignore
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>

          <section class="task-skills-dialog__section">
            <h3>Ignored for this task ({ignoredSkills().length})</h3>
            <Show
              when={ignoredSkills().length > 0}
              fallback={<p class="task-skills-dialog__muted">Nothing ignored for this task.</p>}
            >
              <ul class="task-skills-dialog__list">
                <For each={ignoredSkills()}>
                  {(skill) => (
                    <li>
                      <div>
                        <strong>{skill.name}</strong>
                        <span>{skill.description || "Hidden from this task's model prompt."}</span>
                        <Show when={skill.filePath}>
                          <code>{skill.filePath}</code>
                        </Show>
                      </div>
                      <Button
                        variant="secondary"
                        disabled={saving() || props.disabled}
                        onClick={() => restore(skill.name)}
                      >
                        Restore
                      </Button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </section>
        </Show>
      </div>
    </Dialog>
  );
}
