import {
  Check,
  ChevronDown,
  Download,
  LoaderCircle,
  RefreshCw,
  Route,
  SkipForward,
  X,
} from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type {
  TaskPlaybookId,
  TaskWorkflow,
  WorkspaceMattSkillsStatus,
} from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import { notifyError, notifySuccess } from "@/shared/ui/toast";
import {
  PLAYBOOKS,
  SETUP_MATT_SKILLS_PROMPT,
  advanceWorkflow,
  createWorkflow,
  getPlaybook,
  workflowView,
} from "../workflow/playbooks";

type WorkflowStripProps = {
  cwd?: string | null;
  disabled?: boolean;
  workflow?: TaskWorkflow;
  onWorkflowChange: (workflow: TaskWorkflow | null, starterPrompt: string | null) => void;
  /** After skills land: prefill setup + rebind session so PI reloads `.pi/skills`. */
  onSkillsInstalled: (setupPrompt: string) => void | Promise<void>;
  /** Prefill `/setup-matt-pocock-skills` without reinstalling. */
  onContinueSetup: (setupPrompt: string) => void;
};

export function WorkflowStrip(props: WorkflowStripProps) {
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [installOpen, setInstallOpen] = createSignal(false);
  const [installing, setInstalling] = createSignal(false);
  const [installError, setInstallError] = createSignal<string | null>(null);
  const [installSummary, setInstallSummary] = createSignal<string | null>(null);
  const [skillsStatus, setSkillsStatus] = createSignal<WorkspaceMattSkillsStatus | null>(null);
  const view = createMemo(() => (props.workflow ? workflowView(props.workflow) : null));
  const skillsInstalled = () => skillsStatus()?.installed === true;
  const setupComplete = () => skillsStatus()?.setupComplete === true;
  const needsSetup = () => skillsInstalled() && !setupComplete();

  function skillsButtonLabel(compact: boolean): string {
    if (!skillsInstalled()) return compact ? "装 skills" : "安装 skills";
    if (needsSetup()) return "待 setup";
    return compact ? "skills" : "skills 已装";
  }

  function skillsIdleHint(): string {
    if (!skillsInstalled()) return " · 建议先装 Matt skills";
    if (needsSetup()) return " · skills 已装 · 待 /setup";
    return " · Matt skills 已就绪";
  }

  function continueSetup() {
    setPickerOpen(false);
    setInstallOpen(false);
    props.onContinueSetup(SETUP_MATT_SKILLS_PROMPT);
    notifySuccess(
      "已预填 /setup-matt-pocock-skills",
      "点发送开始问答配置（不会自动发送）。",
    );
  }

  createEffect(() => {
    const cwd = props.cwd;
    if (!cwd) {
      setSkillsStatus(null);
      return;
    }
    void refreshSkillsStatus(cwd);
  });

  async function refreshSkillsStatus(cwd: string): Promise<void> {
    try {
      setSkillsStatus(await window.piDesktop.workspace.mattSkillsStatus({ cwd }));
    } catch {
      setSkillsStatus(null);
    }
  }

  function attach(playbookId: TaskPlaybookId) {
    const workflow = createWorkflow(playbookId);
    const starter = getPlaybook(playbookId).steps[0]?.starterPrompt ?? null;
    setPickerOpen(false);
    props.onWorkflowChange(workflow, starter);
  }

  function advance(mode: "done" | "skipped") {
    const current = props.workflow;
    if (!current) return;
    const result = advanceWorkflow(current, mode);
    props.onWorkflowChange(result.workflow, result.starterPrompt);
  }

  function clear() {
    setPickerOpen(false);
    props.onWorkflowChange(null, null);
  }

  function openInstall() {
    setPickerOpen(false);
    setInstallError(null);
    setInstallSummary(null);
    setInstallOpen(true);
    if (props.cwd) void refreshSkillsStatus(props.cwd);
  }

  async function confirmInstall() {
    const cwd = props.cwd;
    if (!cwd || installing()) return;
    setInstalling(true);
    setInstallError(null);
    setInstallSummary(null);
    try {
      const result = await window.piDesktop.workspace.installMattSkills({ cwd });
      if (!result.ok) {
        setInstallError(result.error);
        notifyError("Skills 安装失败", result.error);
        return;
      }
      setInstallSummary(
        `已写入 ${result.skillNames.length} 个 skill → ${result.skillsDir}` +
          (result.trusted ? "；已标记项目 trusted" : ""),
      );
      await refreshSkillsStatus(cwd);
      await props.onSkillsInstalled(SETUP_MATT_SKILLS_PROMPT);
      setInstallOpen(false);
      notifySuccess(
        `已装入 ${result.skillNames.length} 个 Matt skills`,
        "下方输入框已预填 /setup-matt-pocock-skills，点发送开始问答配置（不会自动发送）。",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInstallError(message);
      notifyError("Skills 安装失败", message);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div class="workflow-strip">
      <Show
        when={view()}
        fallback={
          <div class="workflow-strip__idle">
            <div class="workflow-strip__idle-copy">
              <Route size={14} />
              <span>Engineering path</span>
              <small>
                可选 · 与 chat 解耦 · Next 预填 /skill
                {skillsIdleHint()}
              </small>
            </div>
            <div class="workflow-strip__picker">
              <Button
                variant="secondary"
                disabled={props.disabled || !props.cwd}
                onClick={openInstall}
              >
                <Show
                  when={setupComplete()}
                  fallback={
                    <Show when={needsSetup()} fallback={<Download size={14} />}>
                      <RefreshCw size={14} />
                    </Show>
                  }
                >
                  <Check size={14} />
                </Show>
                {skillsButtonLabel(false)}
              </Button>
              <Show when={needsSetup()}>
                <Button
                  variant="primary"
                  disabled={props.disabled || !props.cwd}
                  onClick={continueSetup}
                >
                  去 setup
                </Button>
              </Show>
              <Button
                variant="secondary"
                disabled={props.disabled}
                onClick={() => setPickerOpen((open) => !open)}
              >
                选择路径
                <ChevronDown size={14} />
              </Button>
              <Show when={pickerOpen()}>
                <div class="workflow-strip__menu" role="listbox">
                  <For each={PLAYBOOKS}>
                    {(playbook) => (
                      <button
                        type="button"
                        class="workflow-strip__menu-item"
                        disabled={props.disabled}
                        onClick={() => attach(playbook.id)}
                      >
                        <strong>{playbook.title}</strong>
                        <span>{playbook.description}</span>
                      </button>
                    )}
                  </For>
                  <p class="workflow-strip__menu-hint">
                    Slash starter 依赖当前项目 <code>.pi/skills</code> 里的 Matt engineering
                    skills。
                    <Show
                      when={skillsInstalled()}
                      fallback={" 未检测到时可点「安装 skills」。"}
                    >
                      <Show
                        when={setupComplete()}
                        fallback={" 已装 skills，但仍缺 setup 产物——可点「去 setup」。"}
                      >
                        {" 当前项目 skills + setup 均已就绪。"}
                      </Show>
                    </Show>
                  </p>
                </div>
              </Show>
            </div>
          </div>
        }
      >
        {(current) => (
          <div class="workflow-strip__active">
            <div class="workflow-strip__progress">
              <Route size={14} />
              <span class="workflow-strip__count">
                {current().completed
                  ? "完成"
                  : `${current().stepIndex + 1}/${current().stepCount}`}
              </span>
              <span class="workflow-strip__step">{current().stepDef.label}</span>
              <span class="workflow-strip__blurb">{current().stepDef.blurb}</span>
            </div>
            <div class="workflow-strip__actions">
              <Button
                variant="secondary"
                disabled={props.disabled || !props.cwd}
                onClick={openInstall}
              >
                <Show
                  when={setupComplete()}
                  fallback={
                    <Show when={needsSetup()} fallback={<Download size={14} />}>
                      <RefreshCw size={14} />
                    </Show>
                  }
                >
                  <Check size={14} />
                </Show>
                {skillsButtonLabel(true)}
              </Button>
              <Show when={needsSetup()}>
                <Button
                  variant="primary"
                  disabled={props.disabled || !props.cwd}
                  onClick={continueSetup}
                >
                  去 setup
                </Button>
              </Show>
              <Show
                when={!current().completed}
                fallback={
                  <Button variant="secondary" disabled={props.disabled} onClick={clear}>
                    <Check size={14} />
                    清除路径
                  </Button>
                }
              >
                <Show
                  when={current().isLast}
                  fallback={
                    <>
                      <Button
                        variant="secondary"
                        disabled={props.disabled}
                        onClick={() => advance("skipped")}
                      >
                        <SkipForward size={14} />
                        Skip
                      </Button>
                      <Button
                        variant="primary"
                        disabled={props.disabled}
                        onClick={() => advance("done")}
                      >
                        Next
                      </Button>
                    </>
                  }
                >
                  <Button
                    variant="secondary"
                    disabled={props.disabled}
                    onClick={() => advance("skipped")}
                  >
                    <SkipForward size={14} />
                    Skip
                  </Button>
                  <Button
                    variant="primary"
                    disabled={props.disabled}
                    onClick={() => advance("done")}
                  >
                    <Check size={14} />
                    Done
                  </Button>
                </Show>
              </Show>
              <IconButton
                label="Remove engineering path"
                size="sm"
                disabled={props.disabled}
                onClick={clear}
              >
                <X size={14} />
              </IconButton>
            </div>
          </div>
        )}
      </Show>

      <Dialog
        class="orbit-dialog__content--compact"
        open={installOpen()}
        title={skillsInstalled() ? "更新 Matt skills" : "安装 Matt skills 到本项目"}
        onOpenChange={(open) => {
          if (installing()) return;
          setInstallOpen(open);
          if (!open) {
            setInstallError(null);
            setInstallSummary(null);
          }
        }}
      >
        <div class="confirm-dialog">
          <header class="confirm-dialog__header">
            <h2>{skillsInstalled() ? "更新 Matt skills" : "安装 Matt skills 到本项目"}</h2>
            <IconButton
              label="Close"
              size="sm"
              disabled={installing()}
              onClick={() => setInstallOpen(false)}
            >
              <X size={14} />
            </IconButton>
          </header>
          <div class="confirm-dialog__body">
            <Show when={skillsInstalled() && setupComplete()}>
              <p class="confirm-dialog__ok">
                Skills 已装（{skillsStatus()?.skillNames.length ?? 0} 个），setup 产物也齐全。可重新拉取覆盖更新
                skills。
              </p>
            </Show>
            <Show when={needsSetup()}>
              <p class="confirm-dialog__note">
                Skills 已装（{skillsStatus()?.skillNames.length ?? 0} 个），但 setup 未完整。仍缺：
                {(skillsStatus()?.setupMissing ?? []).join(", ")}。可点「去 setup」预填问答，或下方重新拉取
                skills。
              </p>
            </Show>
            <Show when={!skillsInstalled() && (skillsStatus()?.skillNames.length ?? 0) > 0}>
              <p class="confirm-dialog__note">
                已有部分 skills，仍缺：{(skillsStatus()?.missing ?? []).join(", ")}。确认后会完整拉取
                engineering 集合。
              </p>
            </Show>
            <p>确认后将一键完成：</p>
            <ul>
              <li>
                从 GitHub 拉取 <code>mattpocock/skills</code> 的 engineering 集合（需联网）
              </li>
              <li>
                写入当前工作区 <code>.pi/skills/</code>
                （覆盖同名文件夹；会出现在 git 未跟踪/改动里）
              </li>
              <li>
                标记本项目为 PI <strong>trusted</strong>
                （写入 <code>~/.pi/agent/trust.json</code>
                ，否则项目内 skills 可能不被加载）
              </li>
            </ul>
            <p class="confirm-dialog__note">
              装完后：输入框会预填 <code>/setup-matt-pocock-skills</code>
              ，你点发送再开始问答配置（不会自动发送）。不写入全局{" "}
              <code>~/.pi/agent/skills</code>。是否已装 / 已 setup 都以磁盘产物为准（skills 目录 +{" "}
              <code>docs/agents/*</code> + <code>## Agent skills</code>）。
            </p>
            <Show when={props.cwd}>
              {(cwd) => (
                <p class="confirm-dialog__cwd">
                  目标：<code>{cwd()}</code>
                </p>
              )}
            </Show>
            <Show when={installError()}>
              {(message) => <p class="confirm-dialog__error">{message()}</p>}
            </Show>
            <Show when={installSummary()}>
              {(message) => <p class="confirm-dialog__ok">{message()}</p>}
            </Show>
          </div>
          <footer class="confirm-dialog__footer">
            <Button
              variant="secondary"
              disabled={installing() || !props.cwd}
              onClick={() => {
                if (props.cwd) void refreshSkillsStatus(props.cwd);
              }}
            >
              <RefreshCw size={14} />
              重新检测
            </Button>
            <Show when={needsSetup()}>
              <Button variant="secondary" disabled={installing()} onClick={continueSetup}>
                去 setup
              </Button>
            </Show>
            <Button
              variant="secondary"
              disabled={installing()}
              onClick={() => setInstallOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              disabled={installing() || !props.cwd}
              onClick={() => void confirmInstall()}
            >
              <Show when={installing()} fallback={<Download size={14} />}>
                <LoaderCircle size={14} class="spin" />
              </Show>
              {installing()
                ? "安装中…"
                : skillsInstalled()
                  ? "确认并更新"
                  : "确认并安装"}
            </Button>
          </footer>
        </div>
      </Dialog>
    </div>
  );
}
