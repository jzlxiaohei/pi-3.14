import {
  ChevronDown,
  ChevronUp,
  Copy,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-solid";
import { For, Show, createSignal, onMount } from "solid-js";
import type { AgentTemplate } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import { notifyError, notifySuccess } from "@/shared/ui/toast";
import { createPlaybooksModel, type PlaybooksModel } from "../model";

type PlaybooksPageProps = {
  model?: PlaybooksModel;
  onModelReady?: (model: PlaybooksModel) => void;
};

export function PlaybooksPage(props: PlaybooksPageProps) {
  const model = props.model ?? createPlaybooksModel();
  const [agentTemplates, setAgentTemplates] = createSignal<AgentTemplate[]>([]);
  const [confirm, setConfirm] = createSignal<
    null | { kind: "discard"; nextId: string | null } | { kind: "delete" } | { kind: "reset" }
  >(null);

  onMount(() => {
    props.onModelReady?.(model);
    void model.refresh().catch((err) => {
      notifyError("加载路径失败", err instanceof Error ? err.message : String(err));
    });
    void window.piDesktop.templates
      .list()
      .then(setAgentTemplates)
      .catch(() => setAgentTemplates([]));
  });

  async function handleSave(): Promise<void> {
    if (!model.dirty() || model.saving()) return;
    try {
      const ok = await model.save();
      if (ok) notifySuccess("已保存路径");
    } catch (err) {
      notifyError("保存失败", err instanceof Error ? err.message : String(err));
    }
  }

  function requestSelect(id: string | null): void {
    if (model.selectPlaybook(id)) return;
    setConfirm({ kind: "discard", nextId: id });
  }

  async function handleCreate(): Promise<void> {
    if (model.dirty()) {
      setConfirm({ kind: "discard", nextId: "__create__" });
      return;
    }
    try {
      await model.createUserPlaybook();
      notifySuccess("已创建用户路径");
    } catch (err) {
      notifyError("创建失败", err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDuplicate(): Promise<void> {
    if (model.dirty()) {
      setConfirm({ kind: "discard", nextId: "__duplicate__" });
      return;
    }
    try {
      const created = await model.duplicateSelected();
      if (created) notifySuccess("已复制路径");
    } catch (err) {
      notifyError("复制失败", err instanceof Error ? err.message : String(err));
    }
  }

  async function resolveDiscard(): Promise<void> {
    const state = confirm();
    if (!state || state.kind !== "discard") return;
    model.discardDraft();
    setConfirm(null);
    const next = state.nextId;
    if (next === "__create__") {
      try {
        await model.createUserPlaybook();
        notifySuccess("已创建用户路径");
      } catch (err) {
        notifyError("创建失败", err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (next === "__duplicate__") {
      try {
        const created = await model.duplicateSelected();
        if (created) notifySuccess("已复制路径");
      } catch (err) {
        notifyError("复制失败", err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (next === "__delete__") {
      setConfirm({ kind: "delete" });
      return;
    }
    if (next === "__reset__") {
      setConfirm({ kind: "reset" });
      return;
    }
    model.selectPlaybook(next, { force: true });
  }

  function requestDelete(): void {
    if (model.dirty()) {
      setConfirm({ kind: "discard", nextId: "__delete__" });
      return;
    }
    setConfirm({ kind: "delete" });
  }

  function requestReset(): void {
    if (model.dirty()) {
      setConfirm({ kind: "discard", nextId: "__reset__" });
      return;
    }
    setConfirm({ kind: "reset" });
  }

  const draft = () => model.draft();
  const selected = () => model.selected();
  const stepCount = () => draft()?.steps.length ?? 0;

  return (
    <div class="templates-page playbooks-page">
      <aside class="templates-list-panel">
        <header class="templates-list-panel__head">
          <div>
            <h1>路径模板</h1>
            <p>Playbook：步骤顺序与 Agent Template</p>
          </div>
          <Button
            variant="primary"
            class="playbooks-toolbar-btn"
            disabled={model.busyAction() || model.loading()}
            onClick={() => void handleCreate()}
          >
            <Plus size={14} />
            <span>新建</span>
          </Button>
        </header>

        <Show
          when={!model.loading()}
          fallback={
            <p class="templates-muted">
              <LoaderCircle class="at-spin" size={14} /> 加载中…
            </p>
          }
        >
          <ul class="playbooks-list">
            <For each={model.playbooks()}>
              {(item) => (
                <li>
                  <button
                    type="button"
                    class="playbooks-list__row"
                    data-active={model.selectedId() === item.id ? "true" : undefined}
                    onClick={() => requestSelect(item.id)}
                  >
                    <span class="playbooks-list__title">{item.name}</span>
                    <span class="playbooks-list__meta">
                      <span
                        class="templates-badge"
                        classList={{ "templates-badge--user": item.source === "user" }}
                      >
                        {item.source === "system" ? "系统" : "用户"}
                      </span>
                      <span class="playbooks-list__count">{item.steps.length} 步</span>
                    </span>
                    <Show when={item.description.trim()}>
                      <span class="playbooks-list__desc">{item.description}</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <Show when={model.playbooks().length === 0}>
            <p class="templates-muted">暂无路径模板</p>
          </Show>
        </Show>
      </aside>

      <section class="templates-detail-panel playbooks-detail">
        <Show
          when={selected() && draft()}
          fallback={<p class="templates-muted templates-detail-empty">选择左侧路径以编辑</p>}
        >
          {/* Identity + toolbar */}
          <header class="playbooks-detail__toolbar">
            <div class="playbooks-detail__identity">
              <div class="playbooks-detail__title-row">
                <h2 class="playbooks-detail__title">{draft()!.name || "未命名路径"}</h2>
                <span
                  class="templates-badge"
                  classList={{ "templates-badge--user": selected()!.source === "user" }}
                >
                  {selected()!.source === "system" ? "系统" : "用户"}
                </span>
                <Show when={model.dirty()}>
                  <span class="templates-badge templates-badge--dirty">未保存</span>
                </Show>
              </div>
              <p class="playbooks-detail__id">
                <code>{selected()!.id}</code>
                <span aria-hidden="true">·</span>
                <span>{stepCount()} 个步骤</span>
              </p>
            </div>
            <div class="playbooks-detail__actions">
              <IconButton
                label="复制路径"
                size="sm"
                disabled={model.busyAction()}
                onClick={() => void handleDuplicate()}
              >
                <Copy size={15} />
              </IconButton>
              <Show when={selected()!.source === "system"}>
                <IconButton
                  label="恢复出厂"
                  size="sm"
                  disabled={model.busyAction()}
                  onClick={requestReset}
                >
                  <RotateCcw size={15} />
                </IconButton>
              </Show>
              <Show when={selected()!.source === "user"}>
                <IconButton
                  label="删除路径"
                  size="sm"
                  disabled={model.busyAction()}
                  onClick={requestDelete}
                >
                  <Trash2 size={15} />
                </IconButton>
              </Show>
              <Show when={model.dirty()}>
                <Button
                  variant="secondary"
                  class="playbooks-toolbar-btn"
                  disabled={model.saving()}
                  onClick={() => model.discardDraft()}
                >
                  放弃
                </Button>
              </Show>
              <Button
                variant="primary"
                class="playbooks-toolbar-btn"
                disabled={!model.dirty() || model.saving()}
                onClick={() => void handleSave()}
              >
                <Save size={14} />
                <span>{model.saving() ? "保存中…" : "保存"}</span>
              </Button>
            </div>
          </header>

          <div class="playbooks-detail__body">
            <section class="playbooks-meta" aria-label="路径信息">
              <label class="playbooks-meta__field">
                <span class="playbooks-meta__label">名称</span>
                <input
                  type="text"
                  value={draft()!.name}
                  onInput={(event) => model.patchDraft({ name: event.currentTarget.value })}
                />
              </label>
              <label class="playbooks-meta__field playbooks-meta__field--wide">
                <span class="playbooks-meta__label">描述</span>
                <input
                  type="text"
                  placeholder="新建 Task 时展示给用户"
                  value={draft()!.description}
                  onInput={(event) => model.patchDraft({ description: event.currentTarget.value })}
                />
              </label>
            </section>

            <section class="playbooks-steps" aria-label="步骤配置">
              <header class="playbooks-steps__head">
                <div>
                  <h3>步骤</h3>
                  <p>每步绑定 Agent Template；Starter 为建议首条（如 /skill），非强制挂载。</p>
                </div>
                <Button
                  variant="secondary"
                  class="playbooks-toolbar-btn"
                  onClick={() => model.addStep()}
                >
                  <Plus size={14} />
                  <span>添加步骤</span>
                </Button>
              </header>

              <ol class="playbooks-stepper">
                <For each={draft()!.steps}>
                  {(step, index) => (
                    <li class="playbooks-stepper__item">
                      <div class="playbooks-stepper__rail" aria-hidden="true">
                        <span class="playbooks-stepper__node">{index() + 1}</span>
                        <Show when={index() < stepCount() - 1}>
                          <span class="playbooks-stepper__line" />
                        </Show>
                      </div>
                      <div class="playbooks-stepper__card">
                        <header class="playbooks-stepper__card-head">
                          <span class="playbooks-stepper__card-title">
                            {step.label.trim() || step.id || `步骤 ${index() + 1}`}
                          </span>
                          <div class="playbooks-stepper__card-tools">
                            <IconButton
                              label="上移"
                              size="sm"
                              disabled={index() === 0}
                              onClick={() => model.moveStep(index(), -1)}
                            >
                              <ChevronUp size={14} />
                            </IconButton>
                            <IconButton
                              label="下移"
                              size="sm"
                              disabled={index() >= stepCount() - 1}
                              onClick={() => model.moveStep(index(), 1)}
                            >
                              <ChevronDown size={14} />
                            </IconButton>
                            <IconButton
                              label="删除步骤"
                              size="sm"
                              disabled={stepCount() <= 1}
                              onClick={() => model.removeStep(index())}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </div>
                        </header>
                        <div class="playbooks-stepper__grid">
                          <label class="playbooks-stepper__field">
                            <span>显示名</span>
                            <input
                              type="text"
                              value={step.label}
                              onInput={(event) =>
                                model.patchStep(index(), { label: event.currentTarget.value })
                              }
                            />
                          </label>
                          <label class="playbooks-stepper__field">
                            <span>步骤 id</span>
                            <input
                              type="text"
                              class="playbooks-stepper__mono"
                              value={step.id}
                              onInput={(event) =>
                                model.patchStep(index(), { id: event.currentTarget.value })
                              }
                            />
                          </label>
                          <label class="playbooks-stepper__field playbooks-stepper__field--full">
                            <span>说明</span>
                            <input
                              type="text"
                              placeholder="短说明（可选）"
                              value={step.blurb}
                              onInput={(event) =>
                                model.patchStep(index(), { blurb: event.currentTarget.value })
                              }
                            />
                          </label>
                          <label class="playbooks-stepper__field playbooks-stepper__field--full">
                            <span>Agent Template</span>
                            <select
                              value={step.agentTemplateId}
                              onChange={(event) =>
                                model.patchStep(index(), {
                                  agentTemplateId: event.currentTarget.value,
                                })
                              }
                            >
                              <option value="">选择模板…</option>
                              <For each={agentTemplates()}>
                                {(tpl) => (
                                  <option value={tpl.id}>
                                    {tpl.source === "system" ? "系统" : "用户"} · {tpl.name}
                                  </option>
                                )}
                              </For>
                              <Show
                                when={
                                  step.agentTemplateId &&
                                  !agentTemplates().some((t) => t.id === step.agentTemplateId)
                                }
                              >
                                <option value={step.agentTemplateId}>{step.agentTemplateId}</option>
                              </Show>
                            </select>
                          </label>
                          <label class="playbooks-stepper__field playbooks-stepper__field--full">
                            <span>Starter（建议首条）</span>
                            <textarea
                              rows={5}
                              value={step.starterPrompt}
                              placeholder={"/skill-name\n\n任务说明…"}
                              onInput={(event) =>
                                model.patchStep(index(), {
                                  starterPrompt: event.currentTarget.value,
                                })
                              }
                            />
                          </label>
                        </div>
                      </div>
                    </li>
                  )}
                </For>
              </ol>
            </section>
          </div>
        </Show>
      </section>

      <Dialog
        class="orbit-dialog__content--compact"
        open={confirm()?.kind === "discard"}
        title="丢弃未保存的更改"
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <div class="confirm-dialog">
          <header class="confirm-dialog__header">
            <h2>丢弃未保存的更改？</h2>
            <IconButton label="Close" size="sm" onClick={() => setConfirm(null)}>
              <X size={14} />
            </IconButton>
          </header>
          <div class="confirm-dialog__body">
            <p>当前路径有未保存的修改。继续将丢弃这些更改。</p>
          </div>
          <footer class="confirm-dialog__footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void resolveDiscard()}>
              丢弃
            </Button>
          </footer>
        </div>
      </Dialog>

      <Dialog
        class="orbit-dialog__content--compact"
        open={confirm()?.kind === "delete"}
        title="删除路径"
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <div class="confirm-dialog">
          <header class="confirm-dialog__header">
            <h2>删除用户路径？</h2>
            <IconButton label="Close" size="sm" onClick={() => setConfirm(null)}>
              <X size={14} />
            </IconButton>
          </header>
          <div class="confirm-dialog__body">
            <p>删除「{selected()?.name}」后不可恢复。已按此路径创建的 Task 不受影响。</p>
          </div>
          <footer class="confirm-dialog__footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={model.busyAction()}
              onClick={() =>
                void model.deleteSelected().then((ok) => {
                  if (ok) {
                    notifySuccess("已删除路径");
                    setConfirm(null);
                  }
                })
              }
            >
              删除
            </Button>
          </footer>
        </div>
      </Dialog>

      <Dialog
        class="orbit-dialog__content--compact"
        open={confirm()?.kind === "reset"}
        title="恢复出厂"
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <div class="confirm-dialog">
          <header class="confirm-dialog__header">
            <h2>恢复出厂路径？</h2>
            <IconButton label="Close" size="sm" onClick={() => setConfirm(null)}>
              <X size={14} />
            </IconButton>
          </header>
          <div class="confirm-dialog__body">
            <p>将步骤与名称恢复为产品种子。已有 Task 进度不受影响。</p>
          </div>
          <footer class="confirm-dialog__footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={model.busyAction()}
              onClick={() =>
                void model.resetSelectedFactory().then((ok) => {
                  if (ok) {
                    notifySuccess("已恢复出厂");
                    setConfirm(null);
                  }
                })
              }
            >
              恢复出厂
            </Button>
          </footer>
        </div>
      </Dialog>
    </div>
  );
}
