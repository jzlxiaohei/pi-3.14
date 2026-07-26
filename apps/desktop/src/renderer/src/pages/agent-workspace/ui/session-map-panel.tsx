import {
  Crosshair,
  GitFork,
  LoaderCircle,
  Maximize2,
  Network,
  X,
} from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type {
  PiSessionMapContextResult,
  PiSessionMapSnapshot,
  SessionMapDensity,
  SessionMapStructureNode,
} from "../../../../../shared/desktop-contracts";
import { writeClipboardText } from "@/shared/clipboard";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
import { IconButton } from "@/shared/ui/icon-button";
import { notifySuccess } from "@/shared/ui/toast";
import {
  SessionMapCanvas,
  dispatchSessionMapFit,
  dispatchSessionMapReveal,
  type SessionMapCanvasSelection,
} from "./session-map-canvas";

type SessionMapPanelProps = {
  open: boolean;
  busy?: boolean;
  refreshToken?: number;
  onClose: () => void;
  /** Navigate live leaf to resolved branch tip. */
  onSwitch: (navigateId: string, viewEntryId: string) => void;
  /** Scroll timeline to entry on active path. */
  onGoto: (entryId: string) => void;
};

const EMPTY: PiSessionMapSnapshot = {
  sessionId: null,
  sessionPath: null,
  liveLeafId: null,
  turn: { nodes: [], edges: [], density: "turn" },
  entry: { nodes: [], edges: [], density: "entry" },
  analysis: {
    branchPointCount: 0,
    entryCount: 0,
    messageCount: 0,
    compactionCount: 0,
  },
  diagnostics: [],
};

export function SessionMapPanel(props: SessionMapPanelProps) {
  const [snapshot, setSnapshot] = createSignal<PiSessionMapSnapshot>(EMPTY);
  const [density, setDensity] = createSignal<SessionMapDensity>("turn");
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [selected, setSelected] = createSignal<SessionMapCanvasSelection | null>(null);
  const [context, setContext] = createSignal<PiSessionMapContextResult | null>(null);
  const [contextLoading, setContextLoading] = createSignal(false);
  let canvasHost: HTMLDivElement | undefined;
  let contextGen = 0;

  const graph = createMemo(() =>
    density() === "turn" ? snapshot().turn : snapshot().entry,
  );

  createEffect(() => {
    if (!props.open) return;
    props.refreshToken;
    void load();
  });

  // Density toggle: keep selection by entryId across turn/entry node id schemes.
  createEffect(() => {
    const d = density();
    const sel = selected();
    if (!sel) return;
    const g = d === "turn" ? snapshot().turn : snapshot().entry;
    const found = g.nodes.find((n) => n.entryId === sel.entryId || n.id === sel.id);
    if (!found) {
      setSelected(null);
      return;
    }
    if (found.id !== sel.id) {
      setSelected({ ...found, x: 0, y: 0, width: 0, height: 0 });
    }
  });

  createEffect(() => {
    const node = selected();
    if (!props.open) return;
    if (!node) {
      setContext(null);
      return;
    }
    void loadContext(node.entryId);
  });

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const next = await window.piDesktop.session.map();
      setSnapshot(next);
      // Preserve selection by entry id when still present
      const sel = selected();
      if (sel) {
        const g = density() === "turn" ? next.turn : next.entry;
        const found = g.nodes.find((n) => n.entryId === sel.entryId || n.id === sel.id);
        if (!found) setSelected(null);
        else setSelected({ ...found, x: 0, y: 0, width: 0, height: 0 });
      }
    } catch (err) {
      setSnapshot(EMPTY);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadContext(selectionEntryId: string): Promise<void> {
    const gen = ++contextGen;
    setContextLoading(true);
    try {
      const result = await window.piDesktop.session.mapContext({ selectionEntryId });
      if (gen !== contextGen) return;
      setContext(result);
    } catch {
      if (gen !== contextGen) return;
      setContext(null);
    } finally {
      if (gen === contextGen) setContextLoading(false);
    }
  }

  function handleSelect(node: SessionMapCanvasSelection | null): void {
    setSelected(node);
  }

  const canSwitch = createMemo(() => {
    const ctx = context();
    return Boolean(ctx && !ctx.isLiveLeaf && ctx.resolvedLeafId);
  });

  const canGoto = createMemo(() => {
    const node = selected();
    const ctx = context();
    return Boolean(node && node.onActivePath && ctx?.isLiveLeaf !== false);
  });

  function switchBranch(): void {
    const ctx = context();
    const node = selected();
    if (!ctx || !node) return;
    props.onSwitch(ctx.resolvedLeafId, node.entryId);
  }

  function gotoChat(): void {
    const node = selected();
    if (!node) return;
    props.onGoto(node.entryId);
  }

  async function copyEntryId(): Promise<void> {
    const id = selected()?.entryId;
    if (!id) return;
    await writeClipboardText(id);
    notifySuccess("已复制 entry id");
  }

  return (
    <Dialog
      class="orbit-dialog__content--session-map"
      open={props.open}
      title="会话图"
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <div class="session-map-panel">
        <header class="session-map-panel__header">
          <div class="session-map-panel__title">
            <Network size={16} />
            <strong>会话图</strong>
            <Show when={snapshot().analysis.branchPointCount > 0}>
              <span class="session-map-panel__count">
                {snapshot().analysis.branchPointCount} 分叉
              </span>
            </Show>
            <Show when={loading()}>
              <LoaderCircle class="at-spin" size={14} />
            </Show>
          </div>
          <div class="session-map-panel__actions">
            <div class="session-map-density" role="group" aria-label="密度">
              <button
                type="button"
                data-active={density() === "turn" ? "true" : "false"}
                onClick={() => setDensity("turn")}
              >
                回合
              </button>
              <button
                type="button"
                data-active={density() === "entry" ? "true" : "false"}
                onClick={() => setDensity("entry")}
              >
                条目
              </button>
            </div>
            <IconButton
              label="适应画布"
              size="sm"
              onClick={() => {
                const el = canvasHost?.querySelector(
                  "[data-session-map-canvas]",
                ) as HTMLElement | null;
                dispatchSessionMapFit(el ?? undefined);
              }}
            >
              <Maximize2 size={14} />
            </IconButton>
            <IconButton
              label="定位选中"
              size="sm"
              disabled={!selected()}
              onClick={() => {
                const el = canvasHost?.querySelector(
                  "[data-session-map-canvas]",
                ) as HTMLElement | null;
                dispatchSessionMapReveal(el ?? undefined);
              }}
            >
              <Crosshair size={14} />
            </IconButton>
            <IconButton label="关闭会话图" size="sm" onClick={() => props.onClose()}>
              <X size={15} />
            </IconButton>
          </div>
        </header>

        <p class="session-map-panel__hint">
          左：会话树（高亮当前路径）。右：选中节点的模型上下文投影（祖先链 + 压缩后的有效消息）。默认仅预览，不切换对话分支。
        </p>

        <div class="session-map-legend" aria-label="图例">
          <span>
            <i class="session-map-legend__swatch session-map-legend__swatch--path" />
            当前路径
          </span>
          <span>
            <i class="session-map-legend__swatch session-map-legend__swatch--side" />
            旁支
          </span>
          <span>
            <i class="session-map-legend__swatch session-map-legend__swatch--compact" />
            压缩
          </span>
          <span>
            <GitFork size={11} /> 分叉点
          </span>
        </div>

        <Show when={error()}>
          <p class="session-map-panel__error">{error()}</p>
        </Show>

        <div class="session-map-panel__body">
          <div class="session-map-panel__map" ref={(el) => (canvasHost = el)}>
            <SessionMapCanvas
              graph={graph()}
              busy={props.busy || loading()}
              selectedId={selected()?.id ?? null}
              onSelect={handleSelect}
            />
          </div>
          <aside class="session-map-detail" aria-label="选中详情">
            <Show
              when={selected()}
              fallback={
                <div class="session-map-detail__empty">
                  <p>选择左侧节点</p>
                  <p class="session-map-detail__muted">
                    查看该分支 tip 的路径、有效上下文，以及 JSONL 无法还原的 system / tools /
                    skills。
                  </p>
                </div>
              }
            >
              {(node) => (
                <SessionMapDetail
                  node={node()}
                  context={context()}
                  loading={contextLoading()}
                  canSwitch={canSwitch()}
                  canGoto={Boolean(node().onActivePath)}
                  busy={props.busy}
                  onSwitch={switchBranch}
                  onGoto={gotoChat}
                  onCopyId={() => void copyEntryId()}
                />
              )}
            </Show>
          </aside>
        </div>

        <footer class="session-map-panel__footer">
          <span>
            {snapshot().analysis.entryCount} 条目 · {snapshot().analysis.messageCount} 消息 ·{" "}
            {snapshot().analysis.compactionCount} 压缩
          </span>
          <Show when={snapshot().liveLeafId}>
            <code class="session-map-panel__leaf">leaf {shortId(snapshot().liveLeafId!)}</code>
          </Show>
        </footer>
      </div>
    </Dialog>
  );
}

function SessionMapDetail(props: {
  node: SessionMapStructureNode;
  context: PiSessionMapContextResult | null;
  loading: boolean;
  canSwitch: boolean;
  canGoto: boolean;
  busy?: boolean;
  onSwitch: () => void;
  onGoto: () => void;
  onCopyId: () => void;
}) {
  const ctx = () => props.context;
  const projection = () => ctx()?.projection;
  const excluded = createMemo(() => new Set(projection()?.excludedPathEntryIds ?? []));

  return (
    <div class="session-map-detail__inner">
      <header class="session-map-detail__head">
        <div>
          <strong>{props.node.label}</strong>
          <p class="session-map-detail__preview">{props.node.preview}</p>
        </div>
        <div class="session-map-detail__badges">
          <Show when={props.node.onActivePath}>
            <span class="session-map-detail__badge">当前路径</span>
          </Show>
          <Show when={!props.node.onActivePath}>
            <span class="session-map-detail__badge session-map-detail__badge--side">旁支</span>
          </Show>
          <Show when={ctx()?.isLiveLeaf}>
            <span class="session-map-detail__badge session-map-detail__badge--live">当前分支</span>
          </Show>
          <Show when={ctx() && !ctx()!.isLiveLeaf}>
            <span class="session-map-detail__badge">预览</span>
          </Show>
        </div>
      </header>

      <div class="session-map-detail__actions">
        <Button
          variant="primary"
          disabled={!props.canSwitch || props.busy}
          onClick={() => props.onSwitch()}
        >
          切换到此分支
        </Button>
        <Button
          variant="secondary"
          disabled={!props.canGoto || props.busy}
          onClick={() => props.onGoto()}
        >
          在对话中定位
        </Button>
        <Button variant="secondary" onClick={() => props.onCopyId()}>
          复制 id
        </Button>
      </div>
      <Show when={!props.canGoto && props.node && !props.node.onActivePath}>
        <p class="session-map-detail__muted">不在当前对话路径上；请先切换分支后再定位。</p>
      </Show>

      <Show when={props.loading}>
        <p class="session-map-detail__muted">
          <LoaderCircle class="at-spin" size={12} /> 加载上下文…
        </p>
      </Show>

      <Show when={ctx()}>
        {(c) => (
          <>
            <section class="session-map-detail__section">
              <h4>投影叶</h4>
              <p>
                <code>{shortId(c().resolvedLeafId)}</code>
                <span class="session-map-detail__muted">
                  {" "}
                  · 路径 {c().projection.pathEntryIds.length} · 有效{" "}
                  {c().projection.effectiveEntryIds.length}
                </span>
              </p>
            </section>

            <section class="session-map-detail__section">
              <h4>路径（根 → 叶）</h4>
              <ol class="session-map-detail__path">
                <For each={c().projection.pathEntryIds}>
                  {(id) => (
                    <li
                      classList={{
                        "session-map-detail__path-item--excluded": excluded().has(id),
                        "session-map-detail__path-item--sel": id === props.node.entryId,
                      }}
                    >
                      <code>{shortId(id)}</code>
                      <Show when={excluded().has(id)}>
                        <span class="session-map-detail__tag">已压缩排除</span>
                      </Show>
                    </li>
                  )}
                </For>
              </ol>
            </section>

            <section class="session-map-detail__section">
              <h4>有效消息（JSONL 可还原）</h4>
              <Show
                when={c().projection.messages.length > 0}
                fallback={<p class="session-map-detail__muted">无有效消息</p>}
              >
                <ul class="session-map-detail__messages">
                  <For each={c().projection.messages}>
                    {(m) => (
                      <li>
                        <span class="session-map-detail__role">{m.role}</span>
                        <Show when={m.toolCalls?.length}>
                          <span class="session-map-detail__muted">
                            {" "}
                            tools: {m.toolCalls!.map((t) => t.name).join(", ")}
                          </span>
                        </Show>
                        <p>{m.text || "—"}</p>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </section>

            <Show when={c().projection.latestCompaction}>
              {(comp) => (
                <section class="session-map-detail__section">
                  <h4>压缩</h4>
                  <p class="session-map-detail__muted">
                    entry <code>{shortId(comp().entryId)}</code> · firstKept{" "}
                    <code>{shortId(comp().firstKeptEntryId)}</code>
                    <Show when={comp().tokensBefore != null}>
                      {" "}
                      · ~{Math.round((comp().tokensBefore ?? 0) / 1000)}k tok
                    </Show>
                  </p>
                </section>
              )}
            </Show>

            <section class="session-map-detail__section">
              <h4>路径上的模型状态</h4>
              <p class="session-map-detail__muted">
                model{" "}
                {c().projection.model
                  ? `${c().projection.model!.provider}/${c().projection.model!.id}`
                  : "—"}{" "}
                · thinking {c().projection.thinkingLevel ?? "—"}
              </p>
            </section>

            <section class="session-map-detail__section">
              <h4>JSONL 不含</h4>
              <p class="session-map-detail__callout">
                system prompt / tools / skills 不在 session 文件中，需 live host。
              </p>
              <Show when={c().liveHud}>
                {(hud) => (
                  <div class="session-map-detail__live">
                    <Show when={hud().systemPromptPreview}>
                      <p>
                        <strong>System（预览）</strong>
                        <br />
                        {hud().systemPromptPreview}
                      </p>
                    </Show>
                    <p>
                      <strong>Skills</strong> ({hud().skillNames.length}){" "}
                      {hud().skillNames.slice(0, 12).join(", ") || "—"}
                    </p>
                    <p>
                      <strong>Tools</strong> ({hud().toolNames.length}){" "}
                      {hud().toolNames.slice(0, 12).join(", ") || "—"}
                    </p>
                  </div>
                )}
              </Show>
            </section>

            <Show when={c().projection.diagnostics.length > 0}>
              <section class="session-map-detail__section">
                <h4>诊断</h4>
                <ul class="session-map-detail__diag">
                  <For each={c().projection.diagnostics}>
                    {(d) => (
                      <li>
                        [{d.severity}] {d.message}
                      </li>
                    )}
                  </For>
                </ul>
              </section>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}
