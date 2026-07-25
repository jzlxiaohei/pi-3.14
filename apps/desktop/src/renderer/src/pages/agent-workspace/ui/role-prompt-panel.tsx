import { RotateCcw, Save } from "lucide-solid";
import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Agent } from "../../../../../shared/desktop-contracts";
import {
  isRolePromptUnset,
  normalizeRolePromptForSave,
  rolePromptEditorText,
} from "../../../../../shared/pi-default-role-prompt";
import { Button } from "@/shared/ui/button";
import { notifyError, notifySuccess } from "@/shared/ui/toast";

type RolePromptPanelProps = {
  agent: Agent | null;
  disabled?: boolean;
  onAgentUpdated?: (agent: Agent) => void;
  onRolePromptSaved?: () => void;
};

/** Editable Role Prompt for the chat gutter (right of conversation). */
export function RolePromptPanel(props: RolePromptPanelProps) {
  const [roleDraft, setRoleDraft] = createSignal("");
  const [roleSaving, setRoleSaving] = createSignal(false);
  const [roleRestoring, setRoleRestoring] = createSignal(false);

  let lastRoleSyncKey = "";
  createEffect(() => {
    const id = props.agent?.id ?? "";
    const prompt = props.agent?.systemPrompt ?? "";
    const key = `${id}\0${prompt}`;
    if (key === lastRoleSyncKey) return;
    lastRoleSyncKey = key;
    setRoleDraft(rolePromptEditorText(prompt));
  });

  const storedUnset = createMemo(() => isRolePromptUnset(props.agent?.systemPrompt));
  const baseline = createMemo(() => rolePromptEditorText(props.agent?.systemPrompt));
  const roleDirty = createMemo(() => {
    if (!props.agent) return false;
    return roleDraft() !== baseline();
  });
  const canRestoreTemplate = createMemo(() => Boolean(props.agent?.templateId));
  const busy = () => roleSaving() || roleRestoring() || Boolean(props.disabled);

  async function saveRolePrompt(): Promise<void> {
    const agent = props.agent;
    if (!agent || roleSaving()) return;
    setRoleSaving(true);
    try {
      const systemPrompt = normalizeRolePromptForSave(roleDraft());
      const updated = await window.piDesktop.agents.update({
        id: agent.id,
        systemPrompt,
        confirmRolePrompt: true,
      });
      if (!updated) {
        notifyError("未能保存 Role Prompt");
        return;
      }
      // Re-sync editor: empty storage → show PI default fill again.
      lastRoleSyncKey = `${updated.id}\0${updated.systemPrompt}`;
      setRoleDraft(rolePromptEditorText(updated.systemPrompt));
      props.onAgentUpdated?.(updated);
      props.onRolePromptSaved?.();
      notifySuccess(
        "已保存 Role Prompt",
        isRolePromptUnset(updated.systemPrompt)
          ? "未设置自定义角色，后续回合使用 PI 完整默认"
          : "后续回合将使用新角色",
      );
    } catch (err) {
      notifyError("未能保存 Role Prompt", err instanceof Error ? err.message : String(err));
    } finally {
      setRoleSaving(false);
    }
  }

  async function restoreRolePrompt(): Promise<void> {
    const agent = props.agent;
    if (!agent?.templateId || roleRestoring()) return;
    setRoleRestoring(true);
    try {
      const result = await window.piDesktop.agents.restoreRolePrompt(agent.id);
      if (!result.ok) {
        notifyError("无法恢复 Template 默认", result.error);
        return;
      }
      lastRoleSyncKey = `${result.agent.id}\0${result.agent.systemPrompt}`;
      setRoleDraft(rolePromptEditorText(result.agent.systemPrompt));
      props.onAgentUpdated?.(result.agent);
      props.onRolePromptSaved?.();
      notifySuccess("已恢复 Template Role Prompt");
    } catch (err) {
      notifyError("无法恢复 Template 默认", err instanceof Error ? err.message : String(err));
    } finally {
      setRoleRestoring(false);
    }
  }

  return (
    <section class="role-prompt-panel" aria-label="Role Prompt">
      <header class="role-prompt-panel__head">
        <div class="role-prompt-panel__title">
          <h3>Role Prompt</h3>
          <Show
            when={storedUnset()}
            fallback={<span class="role-prompt-badge">自定义</span>}
          >
            <span class="role-prompt-badge role-prompt-badge--default">未设置</span>
          </Show>
        </div>
        <Show
          when={storedUnset()}
          fallback={
            <p class="role-prompt-panel__hint">
              本 Agent 角色底座。保存后<strong>替换</strong> PI 默认 coding base（后续回合生效）。
              问卷协议等 product append 不在此编辑。
            </p>
          }
        >
          <p class="role-prompt-panel__hint role-prompt-panel__hint--default">
            用户未设置，已<strong>默认填充</strong> PI 完整 coding base（identity + tools +
            guidelines + docs）。
            <code>{"{piPackage}"}</code> 在 live bind 时解析为安装路径；下方不含问卷协议 /
            project_context / skills / cwd（那些在 bind 时再拼）。
            未改写保存仍按「空 = 回退 PI 完整默认」。
          </p>
        </Show>
      </header>

      <Show
        when={props.agent}
        fallback={<p class="role-prompt-panel__empty">选择 Agent 后可编辑角色。</p>}
      >
        <textarea
          class="role-prompt-panel__textarea"
          classList={{ "role-prompt-panel__textarea--default-fill": storedUnset() && !roleDirty() }}
          value={roleDraft()}
          disabled={busy()}
          rows={18}
          onInput={(event) => setRoleDraft(event.currentTarget.value)}
        />
        <div class="role-prompt-panel__actions">
          <Button
            variant="secondary"
            disabled={!canRestoreTemplate() || busy()}
            title={
              canRestoreTemplate()
                ? "从 Agent Template 恢复 Role Prompt"
                : "无 Template 的 ad-hoc Agent 不能恢复默认"
            }
            onClick={() => void restoreRolePrompt()}
          >
            <RotateCcw size={14} />
            恢复
          </Button>
          <Show when={roleDirty()}>
            <Button
              variant="secondary"
              disabled={busy()}
              onClick={() => setRoleDraft(baseline())}
            >
              放弃
            </Button>
          </Show>
          <Button
            variant="primary"
            disabled={!roleDirty() || busy()}
            onClick={() => void saveRolePrompt()}
          >
            <Save size={14} />
            {roleSaving() ? "保存中…" : "保存"}
          </Button>
        </div>
      </Show>
    </section>
  );
}
