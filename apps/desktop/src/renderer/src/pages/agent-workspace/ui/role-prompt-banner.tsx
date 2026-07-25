import { Check, PanelRight } from "lucide-solid";
import { Show, createMemo } from "solid-js";
import type { Agent } from "../../../../../shared/desktop-contracts";
import {
  isRolePromptUnset,
  rolePromptEditorText,
} from "../../../../../shared/pi-default-role-prompt";
import { Button } from "@/shared/ui/button";

type RolePromptBannerProps = {
  agent: Agent | null;
  ready: boolean;
  confirming?: boolean;
  onConfirm: () => void;
  /** Focus the chat-right Role Prompt editor (close inspector if needed). */
  onEditRolePrompt: () => void;
};

export function RolePromptBanner(props: RolePromptBannerProps) {
  const visible = createMemo(
    () =>
      props.ready &&
      props.agent != null &&
      props.agent.rolePromptConfirmedAt == null,
  );

  const preview = createMemo(() => {
    const agent = props.agent;
    if (!agent) return "";
    const display = rolePromptEditorText(agent.systemPrompt);
    const first = display.split("\n").find((line) => line.trim()) ?? display;
    const snippet = first.length > 120 ? `${first.slice(0, 119)}…` : first;
    if (isRolePromptUnset(agent.systemPrompt)) {
      return `未设置 · 默认填充 PI coding base · ${snippet}`;
    }
    return snippet;
  });

  return (
    <Show when={visible() ? props.agent : null}>
      {(agent) => (
        <div class="role-prompt-banner" role="status">
          <div class="role-prompt-banner__copy">
            <div>
              <strong>确认本步角色</strong>
              <span>
                <code>{agent().name}</code>
                <Show when={agent().templateId}>
                  {(tid) => (
                    <>
                      {" · 模板 "}
                      <code title={tid()}>{tid()}</code>
                    </>
                  )}
                </Show>
                {" · "}
                {preview()}
              </span>
            </div>
          </div>
          <div class="role-prompt-banner__actions">
            <Button variant="secondary" onClick={() => props.onEditRolePrompt()}>
              <PanelRight size={14} />
              编辑角色
            </Button>
            <Button
              variant="primary"
              disabled={props.confirming}
              onClick={() => props.onConfirm()}
            >
              <Check size={14} />
              确认
            </Button>
          </div>
        </div>
      )}
    </Show>
  );
}
