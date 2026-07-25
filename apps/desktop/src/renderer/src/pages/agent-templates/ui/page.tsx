import {
  Copy,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-solid";
import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { AgentTemplate } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import { notifyError, notifySuccess } from "@/shared/ui/toast";
import { createTemplatesModel, type TemplatesModel } from "../model";

type TemplatesPageProps = {
  model?: TemplatesModel;
  onModelReady?: (model: TemplatesModel) => void;
};

export function TemplatesPage(props: TemplatesPageProps) {
  const model = props.model ?? createTemplatesModel();
  /**
   * discard.nextId is either a template id, null, or a deferred action token:
   * __create__ | __duplicate__ | __delete__ | __reset__
   */
  const [confirm, setConfirm] = createSignal<
    null | { kind: "discard"; nextId: string | null } | { kind: "delete" } | { kind: "reset" }
  >(null);
  const [skillInput, setSkillInput] = createSignal("");

  onMount(() => {
    props.onModelReady?.(model);
    void model.refresh().catch((err) => {
      notifyError("加载模板失败", err instanceof Error ? err.message : String(err));
    });
  });

  createEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isSave = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";
      if (!isSave) return;
      event.preventDefault();
      void handleSave();
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  async function handleSave(): Promise<void> {
    if (!model.dirty() || model.saving()) return;
    try {
      const ok = await model.save();
      if (ok) notifySuccess("已保存模板");
    } catch (err) {
      notifyError("保存失败", err instanceof Error ? err.message : String(err));
    }
  }

  function requestSelect(id: string | null): void {
    if (model.selectTemplate(id)) return;
    setConfirm({ kind: "discard", nextId: id });
  }

  async function handleCreate(): Promise<void> {
    if (model.dirty()) {
      setConfirm({ kind: "discard", nextId: "__create__" });
      return;
    }
    try {
      await model.createUserTemplate();
      notifySuccess("已创建用户模板");
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
      if (created) notifySuccess("已复制模板");
    } catch (err) {
      notifyError("复制失败", err instanceof Error ? err.message : String(err));
    }
  }

  /** Spec: dirty on current row → discard dialog first, then delete confirm. */
  function requestDelete(): void {
    if (model.dirty()) {
      setConfirm({ kind: "discard", nextId: "__delete__" });
      return;
    }
    setConfirm({ kind: "delete" });
  }

  /** Spec: dirty on current row → discard dialog first, then reset confirm. */
  function requestReset(): void {
    if (model.dirty()) {
      setConfirm({ kind: "discard", nextId: "__reset__" });
      return;
    }
    setConfirm({ kind: "reset" });
  }

  async function resolveDiscard(): Promise<void> {
    const state = confirm();
    if (!state || state.kind !== "discard") return;
    model.discardDraft();
    setConfirm(null);
    const next = state.nextId;
    if (next === "__create__") {
      try {
        await model.createUserTemplate();
        notifySuccess("已创建用户模板");
      } catch (err) {
        notifyError("创建失败", err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (next === "__duplicate__") {
      try {
        const created = await model.duplicateSelected();
        if (created) notifySuccess("已复制模板");
      } catch (err) {
        notifyError("复制失败", err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (next === "__delete__") {
      // Unsaved edits discarded; still require explicit delete confirmation.
      setConfirm({ kind: "delete" });
      return;
    }
    if (next === "__reset__") {
      setConfirm({ kind: "reset" });
      return;
    }
    model.selectTemplate(next, { force: true });
  }

  async function resolveDelete(): Promise<void> {
    try {
      const ok = await model.deleteSelected();
      if (ok) notifySuccess("已删除模板");
      setConfirm(null);
    } catch (err) {
      notifyError("删除失败", err instanceof Error ? err.message : String(err));
    }
  }

  async function resolveReset(): Promise<void> {
    try {
      const ok = await model.resetSelectedFactory();
      if (ok) notifySuccess("已恢复出厂设置");
      setConfirm(null);
    } catch (err) {
      notifyError("恢复失败", err instanceof Error ? err.message : String(err));
    }
  }

  function addIgnoredSkill(): void {
    const name = skillInput().trim();
    if (!name) return;
    const current = model.draft()?.ignoredSkillNames ?? [];
    if (!current.includes(name)) {
      model.setIgnoredSkillNames([...current, name]);
    }
    setSkillInput("");
  }

  function discardConfirmMessage(): string {
    const state = confirm();
    const next = state?.kind === "discard" ? state.nextId : null;
    const tail =
      next === "__delete__"
        ? "，然后确认删除模板"
        : next === "__reset__"
          ? "，然后确认恢复出厂"
          : next === "__duplicate__"
            ? "，然后复制模板"
            : next === "__create__"
              ? "，然后新建模板"
              : "";
    return `当前模板有未保存的修改。继续将丢弃这些更改${tail}。`;
  }

  const draft = () => model.draft();
  const selected = () => model.selected();

  return (
    <div class="templates-page">
      <aside class="templates-list-panel">
        <header class="templates-list-panel__head">
          <div>
            <h1>模板库</h1>
            <p>管理系统与用户 Agent Template</p>
          </div>
          <Button
            variant="primary"
            disabled={model.busyAction() || model.loading()}
            onClick={() => void handleCreate()}
          >
            <Plus size={14} />
            新建
          </Button>
        </header>

        <label class="templates-search">
          <Search size={14} />
          <input
            type="search"
            placeholder="搜索名称或描述"
            value={model.query()}
            onInput={(event) => model.setQuery(event.currentTarget.value)}
          />
        </label>

        <Show
          when={!model.loading()}
          fallback={
            <p class="templates-muted">
              <LoaderCircle class="at-spin" size={14} /> 加载中…
            </p>
          }
        >
          <TemplateGroup
            title="系统"
            items={model.systemTemplates()}
            selectedId={model.selectedId()}
            onSelect={requestSelect}
          />
          <TemplateGroup
            title="用户"
            items={model.userTemplates()}
            selectedId={model.selectedId()}
            onSelect={requestSelect}
          />
          <Show when={model.filtered().length === 0}>
            <p class="templates-muted">没有匹配的模板</p>
          </Show>
        </Show>
      </aside>

      <section class="templates-detail-panel">
        <Show
          when={selected() && draft()}
          fallback={<p class="templates-muted templates-detail-empty">选择左侧模板以编辑</p>}
        >
          <header class="templates-detail-panel__head">
            <div class="templates-detail-panel__title">
              <h2>{draft()!.name || "未命名模板"}</h2>
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
            <div class="templates-detail-panel__actions">
              <Button
                variant="secondary"
                disabled={model.busyAction()}
                onClick={() => void handleDuplicate()}
              >
                <Copy size={14} />
                复制
              </Button>
              <Show when={selected()!.source === "system"}>
                <Button
                  variant="secondary"
                  disabled={model.busyAction()}
                  onClick={requestReset}
                >
                  <RotateCcw size={14} />
                  恢复出厂
                </Button>
              </Show>
              <Show when={selected()!.source === "user"}>
                <Button
                  variant="secondary"
                  disabled={model.busyAction()}
                  onClick={requestDelete}
                >
                  <Trash2 size={14} />
                  删除
                </Button>
              </Show>
              <Show when={model.dirty()}>
                <Button
                  variant="secondary"
                  disabled={model.saving()}
                  onClick={() => model.discardDraft()}
                >
                  放弃
                </Button>
              </Show>
              <Button
                variant="primary"
                disabled={!model.dirty() || model.saving()}
                onClick={() => void handleSave()}
              >
                <Save size={14} />
                {model.saving() ? "保存中…" : "保存"}
              </Button>
            </div>
          </header>

          <div class="templates-form">
            <label class="templates-field">
              <span>名称</span>
              <input
                type="text"
                value={draft()!.name}
                onInput={(event) => model.patchDraft({ name: event.currentTarget.value })}
              />
            </label>

            <label class="templates-field">
              <span>描述</span>
              <input
                type="text"
                placeholder="仅用于模板库展示，不会进入模型"
                value={draft()!.description}
                onInput={(event) => model.patchDraft({ description: event.currentTarget.value })}
              />
              <small>仅 UI 元数据；创建 Agent 时不会写入快照。</small>
            </label>

            <label class="templates-field templates-field--block">
              <span>Role Prompt</span>
              <textarea
                rows={16}
                placeholder="可留空：实例化时回退 PI 默认 coding base"
                value={draft()!.systemPrompt}
                onInput={(event) =>
                  model.patchDraft({ systemPrompt: event.currentTarget.value })
                }
              />
              <small>模板 Role Prompt。空 = 之后新建 Agent 使用 PI 默认角色底座。</small>
            </label>

            <div class="templates-field templates-field--block">
              <span>技能忽略</span>
              <p class="templates-hint">
                与 Agent 技能忽略相同：下列名称不会在实例化后的 skill 列表中展示给模型。
              </p>
              <div class="templates-skill-add">
                <input
                  type="text"
                  placeholder="技能名称"
                  value={skillInput()}
                  onInput={(event) => setSkillInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addIgnoredSkill();
                    }
                  }}
                />
                <Button variant="secondary" onClick={addIgnoredSkill}>
                  添加
                </Button>
              </div>
              <Show
                when={(draft()?.ignoredSkillNames.length ?? 0) > 0}
                fallback={<p class="templates-muted">未忽略任何技能</p>}
              >
                <ul class="templates-skill-chips">
                  <For each={draft()!.ignoredSkillNames}>
                    {(name) => (
                      <li>
                        <code>{name}</code>
                        <IconButton
                          label={`移除 ${name}`}
                          size="sm"
                          onClick={() =>
                            model.setIgnoredSkillNames(
                              (draft()?.ignoredSkillNames ?? []).filter((item) => item !== name),
                            )
                          }
                        >
                          <X size={12} />
                        </IconButton>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
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
            <p>{discardConfirmMessage()}</p>
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
        title="删除模板"
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <div class="confirm-dialog">
          <header class="confirm-dialog__header">
            <h2>删除用户模板？</h2>
            <IconButton label="Close" size="sm" onClick={() => setConfirm(null)}>
              <X size={14} />
            </IconButton>
          </header>
          <div class="confirm-dialog__body">
            <p>
              删除「{selected()?.name ?? "此模板"}」后不可恢复。已从该模板创建的 Agent
              会保留快照，但不再关联此模板。
            </p>
          </div>
          <footer class="confirm-dialog__footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={model.busyAction()}
              onClick={() => void resolveDelete()}
            >
              <Trash2 size={14} />
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
            <h2>恢复出厂设置？</h2>
            <IconButton label="Close" size="sm" onClick={() => setConfirm(null)}>
              <X size={14} />
            </IconButton>
          </header>
          <div class="confirm-dialog__body">
            <p>
              将名称、Role Prompt、技能策略恢复为产品出厂种子，并清空描述。已有 Agent
              快照不受影响。
            </p>
          </div>
          <footer class="confirm-dialog__footer">
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={model.busyAction()}
              onClick={() => void resolveReset()}
            >
              <RotateCcw size={14} />
              恢复出厂
            </Button>
          </footer>
        </div>
      </Dialog>
    </div>
  );
}

function TemplateGroup(props: {
  title: string;
  items: AgentTemplate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Show when={props.items.length > 0}>
      <section class="templates-group">
        <h3>{props.title}</h3>
        <ul>
          <For each={props.items}>
            {(item) => (
              <li>
                <button
                  type="button"
                  class="templates-row"
                  data-active={props.selectedId === item.id ? "true" : undefined}
                  onClick={() => props.onSelect(item.id)}
                >
                  <span class="templates-row__name">{item.name}</span>
                  <Show when={item.description.trim()}>
                    <span class="templates-row__desc">{item.description}</span>
                  </Show>
                  <span
                    class="templates-badge"
                    classList={{ "templates-badge--user": item.source === "user" }}
                  >
                    {item.source === "system" ? "系统" : "用户"}
                  </span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
}
