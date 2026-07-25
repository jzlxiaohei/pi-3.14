import { Pencil, RotateCcw, Save, X } from "lucide-solid";
import { Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Agent } from "../../../../../shared/desktop-contracts";
import {
  isRolePromptUnset,
  normalizeRolePromptForSave,
  rolePromptEditorText,
} from "../../../../../shared/pi-default-role-prompt";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import { notifyError, notifySuccess } from "@/shared/ui/toast";

type RolePromptPanelProps = {
  agent: Agent | null;
  disabled?: boolean;
  /** Controlled open for the editor dialog (banner “编辑角色”). */
  editorOpen?: boolean;
  onEditorOpenChange?: (open: boolean) => void;
  onAgentUpdated?: (agent: Agent) => void;
  onRolePromptSaved?: () => void;
};

/** Compact Role Prompt summary in the chat gutter; full edit opens a dialog. */
export function RolePromptPanel(props: RolePromptPanelProps) {
  const [internalOpen, setInternalOpen] = createSignal(false);
  const [roleDraft, setRoleDraft] = createSignal("");
  const [roleSaving, setRoleSaving] = createSignal(false);
  const [roleRestoring, setRoleRestoring] = createSignal(false);

  const editorOpen = () => props.editorOpen ?? internalOpen();
  function setEditorOpen(open: boolean): void {
    if (props.onEditorOpenChange) props.onEditorOpenChange(open);
    else setInternalOpen(open);
  }

  let lastRoleSyncKey = "";
  createEffect(() => {
    const id = props.agent?.id ?? "";
    const prompt = props.agent?.systemPrompt ?? "";
    const key = `${id}\0${prompt}`;
    if (key === lastRoleSyncKey) return;
    lastRoleSyncKey = key;
    setRoleDraft(rolePromptEditorText(prompt));
  });

  // When dialog opens, re-sync draft from the live agent (discard stale edits if closed without save).
  createEffect(() => {
    if (!editorOpen()) return;
    const agent = props.agent;
    if (!agent) return;
    setRoleDraft(rolePromptEditorText(agent.systemPrompt));
    lastRoleSyncKey = `${agent.id}\0${agent.systemPrompt}`;
  });

  const storedUnset = createMemo(() => isRolePromptUnset(props.agent?.systemPrompt));
  const baseline = createMemo(() => rolePromptEditorText(props.agent?.systemPrompt));
  const roleDirty = createMemo(() => {
    if (!props.agent) return false;
    return roleDraft() !== baseline();
  });
  const canRestoreTemplate = createMemo(() => Boolean(props.agent?.templateId));
  const busy = () => roleSaving() || roleRestoring() || Boolean(props.disabled);

  const summaryLine = createMemo(() => {
    if (!props.agent) return "选择 Agent 后可查看角色";
    if (storedUnset()) return "未设置 · 使用 PI 默认 coding base";
    const display = rolePromptEditorText(props.agent.systemPrompt);
    const first = display.split("\n").find((line) => line.trim()) ?? display.trim();
    if (!first) return "自定义角色（空正文）";
    return first.length > 72 ? `${first.slice(0, 71)}…` : first;
  });

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
      setEditorOpen(false);
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

  function closeEditor(): void {
    if (busy()) return;
    // Drop unsaved draft on close.
    setRoleDraft(baseline());
    setEditorOpen(false);
  }

  return (
    <>
      <section class="role-prompt-panel" aria-label="Role Prompt">
        <div class="role-prompt-panel__row">
          <div class="role-prompt-panel__meta">
            <div class="role-prompt-panel__title">
              <h3>Role Prompt</h3>
              <Show when={props.agent}>
                <Show
                  when={storedUnset()}
                  fallback={<span class="role-prompt-badge">自定义</span>}
                >
                  <span class="role-prompt-badge role-prompt-badge--default">未设置</span>
                </Show>
              </Show>
            </div>
            <p class="role-prompt-panel__summary" title={summaryLine()}>
              {summaryLine()}
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={!props.agent || Boolean(props.disabled)}
            title="在弹窗中编辑 Role Prompt"
            onClick={() => setEditorOpen(true)}
          >
            <Pencil size={14} />
            编辑
          </Button>
        </div>
      </section>

      <Dialog
        class="orbit-dialog__content--role-prompt"
        open={editorOpen()}
        title="Role Prompt"
        onOpenChange={(open) => {
          if (!open) closeEditor();
          else setEditorOpen(true);
        }}
      >
        <div class="role-prompt-dialog">
          <header class="role-prompt-dialog__header">
            <div class="role-prompt-dialog__heading">
              <h2>Role Prompt</h2>
              <Show when={props.agent}>
                <Show
                  when={storedUnset() && !roleDirty()}
                  fallback={<span class="role-prompt-badge">自定义</span>}
                >
                  <span class="role-prompt-badge role-prompt-badge--default">未设置</span>
                </Show>
              </Show>
            </div>
            <IconButton label="Close" onClick={() => closeEditor()}>
              <X size={16} />
            </IconButton>
          </header>

          <Show
            when={storedUnset() && !roleDirty()}
            fallback={
              <p class="role-prompt-dialog__hint">
                本 Agent 角色底座。保存后<strong>替换</strong> PI 默认 coding base（后续回合生效）。
                问卷协议等 product append 不在此编辑。
              </p>
            }
          >
            <p class="role-prompt-dialog__hint role-prompt-dialog__hint--default">
              用户未设置时展示 PI 完整 coding base 预览。未改写保存仍按「空 = 回退 PI 完整默认」。
              <code>{"{piPackage}"}</code> 在 live bind 时解析。
            </p>
          </Show>

          <Show
            when={props.agent}
            fallback={<p class="role-prompt-panel__empty">选择 Agent 后可编辑角色。</p>}
          >
            <textarea
              class="role-prompt-dialog__textarea"
              classList={{
                "role-prompt-dialog__textarea--default-fill": storedUnset() && !roleDirty(),
              }}
              value={roleDraft()}
              disabled={busy()}
              rows={18}
              spellcheck={false}
              onInput={(event) => setRoleDraft(event.currentTarget.value)}
            />
            <footer class="role-prompt-dialog__actions">
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
                恢复模板
              </Button>
              <div class="role-prompt-dialog__actions-end">
                <Button variant="secondary" disabled={busy()} onClick={() => closeEditor()}>
                  取消
                </Button>
                <Show when={roleDirty()}>
                  <Button
                    variant="secondary"
                    disabled={busy()}
                    onClick={() => setRoleDraft(baseline())}
                  >
                    放弃更改
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
            </footer>
          </Show>
        </div>
      </Dialog>
    </>
  );
}
