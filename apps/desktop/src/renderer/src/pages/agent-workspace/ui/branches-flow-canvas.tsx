import { GitFork, Layers2 } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { PiBranchFlowGraph } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";
import {
  layoutBranchFlow,
  pointsToPath,
  type LaidOutBranchNode,
} from "./branches-flow-layout";

export type BranchesFlowSelection = LaidOutBranchNode;

type BranchesFlowCanvasProps = {
  graph: PiBranchFlowGraph;
  busy?: boolean;
  /** Read-only map: selection drives panel actions; Goto only on active path. */
  onSelect?: (node: BranchesFlowSelection | null) => void;
  /** Close the Branches dialog and scroll chat to this entry when present. */
  onGoto: (entryId: string) => void;
};

type Viewport = { x: number; y: number; scale: number };

const MIN_SCALE = 0.35;
const MAX_SCALE = 2.2;

export function BranchesFlowCanvas(props: BranchesFlowCanvasProps) {
  const laidOut = createMemo(() => layoutBranchFlow(props.graph));
  const [viewport, setViewport] = createSignal<Viewport>({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = createSignal(false);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  let hostRef: HTMLDivElement | undefined;
  let dragOrigin: { x: number; y: number; vx: number; vy: number } | null = null;
  /** True only while a canvas pan gesture is in progress and moved past threshold. */
  let movedDuringDrag = false;
  /** Skip background pointerup→clear right after selecting a node. */
  let ignoreBackgroundClear = false;
  let prevGraph: PiBranchFlowGraph | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const selected = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    return laidOut().nodes.find((node) => node.id === id) ?? null;
  });

  createEffect(() => {
    const graph = props.graph;
    const layout = laidOut();
    // Only reset selection when the graph data changes — not on every select/parent update.
    if (prevGraph !== graph) {
      prevGraph = graph;
      selectNode(null);
      queueMicrotask(() => fitView(layout.width, layout.height));
    }
  });

  function selectNode(node: LaidOutBranchNode | null): void {
    setSelectedId(node?.id ?? null);
    // Resolve from current layout so parent always gets a live node snapshot.
    const live = node ? laidOut().nodes.find((item) => item.id === node.id) ?? node : null;
    props.onSelect?.(live);
  }

  function fitView(width: number, height: number): void {
    const host = hostRef;
    if (!host || width <= 0 || height <= 0) {
      setViewport({ x: 24, y: 24, scale: 1 });
      return;
    }
    const hostW = host.clientWidth;
    const hostH = host.clientHeight;
    if (hostW <= 0 || hostH <= 0) return;
    const pad = 48;
    const scale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min((hostW - pad) / width, (hostH - pad) / height),
      ),
    );
    const x = (hostW - width * scale) / 2;
    const y = (hostH - height * scale) / 2;
    setViewport({ x, y, scale });
  }

  function bindHost(el: HTMLDivElement): void {
    hostRef = el;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      const graph = laidOut();
      if (graph.width > 0 && graph.height > 0) {
        fitView(graph.width, graph.height);
      }
    });
    resizeObserver.observe(el);
    queueMicrotask(() => {
      const graph = laidOut();
      fitView(graph.width, graph.height);
    });
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const host = hostRef;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const prev = viewport();
    const nextScale = clampScale(
      prev.scale * (event.deltaY < 0 ? 1.08 : 0.92),
      MIN_SCALE,
      MAX_SCALE,
    );
    const worldX = (mx - prev.x) / prev.scale;
    const worldY = (my - prev.y) / prev.scale;
    setViewport({
      scale: nextScale,
      x: mx - worldX * nextScale,
      y: my - worldY * nextScale,
    });
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    // Node / preview handle their own interaction — do not start pan or arm clear.
    if (target?.closest(".branches-flow-node, .branches-flow-preview")) return;
    movedDuringDrag = false;
    ignoreBackgroundClear = false;
    dragOrigin = {
      x: event.clientX,
      y: event.clientY,
      vx: viewport().x,
      vy: viewport().y,
    };
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragOrigin) return;
    const dx = event.clientX - dragOrigin.x;
    const dy = event.clientY - dragOrigin.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedDuringDrag = true;
    setViewport((prev) => ({
      ...prev,
      x: dragOrigin!.vx + dx,
      y: dragOrigin!.vy + dy,
    }));
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragOrigin) {
      movedDuringDrag = false;
      return;
    }
    const panned = movedDuringDrag;
    dragOrigin = null;
    movedDuringDrag = false;
    setDragging(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
    // Click empty canvas → clear selection. Skip if a node just selected.
    if (!panned && !ignoreBackgroundClear) {
      selectNode(null);
    }
    ignoreBackgroundClear = false;
  }

  function onNodePointerDown(node: LaidOutBranchNode, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    movedDuringDrag = false;
    ignoreBackgroundClear = true;
    selectNode(node);
  }

  const previewStyle = createMemo(() => {
    const node = selected();
    const host = hostRef;
    if (!node || !host) return null;
    const vp = viewport();
    const panelW = 280;
    const left = vp.x + (node.x + node.width + 12) * vp.scale;
    const top = vp.y + node.y * vp.scale;
    const maxLeft = Math.max(12, host.clientWidth - panelW);
    const maxTop = Math.max(12, host.clientHeight - 200);
    return {
      left: `${Math.min(left, maxLeft)}px`,
      top: `${Math.min(Math.max(12, top), maxTop)}px`,
    };
  });

  onCleanup(() => {
    dragOrigin = null;
    resizeObserver?.disconnect();
    resizeObserver = undefined;
  });

  return (
    <div
      class="branches-flow-canvas"
      classList={{ "branches-flow-canvas--dragging": dragging() }}
      ref={bindHost}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Show when={laidOut().nodes.length === 0}>
        <p class="inspector-empty">No branch structure yet.</p>
      </Show>
      <Show when={laidOut().nodes.length > 0}>
        <div
          class="branches-flow-world"
          style={{
            width: `${laidOut().width}px`,
            height: `${laidOut().height}px`,
            transform: `translate(${viewport().x}px, ${viewport().y}px) scale(${viewport().scale})`,
          }}
        >
          <svg
            class="branches-flow-edges"
            width={laidOut().width}
            height={laidOut().height}
            viewBox={`0 0 ${laidOut().width} ${laidOut().height}`}
            aria-hidden="true"
          >
            <For each={laidOut().edges}>
              {(edge) => (
                <path
                  d={pointsToPath(edge.points)}
                  classList={{
                    "branches-flow-edge": true,
                    "branches-flow-edge--active": edge.onActivePath,
                  }}
                />
              )}
            </For>
          </svg>

          <div class="branches-flow-nodes">
            <For each={laidOut().nodes}>
              {(node) => (
                <button
                  type="button"
                  class="branches-flow-node"
                  classList={{
                    "branches-flow-node--user": node.kind === "user",
                    "branches-flow-node--summary": node.kind === "turn_summary",
                    "branches-flow-node--compaction": node.kind === "compaction",
                    "branches-flow-node--active": node.onActivePath,
                    "branches-flow-node--left": !node.onActivePath,
                    "branches-flow-node--fork": node.isFork,
                    "branches-flow-node--selected": selectedId() === node.id,
                  }}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.width}px`,
                    height: `${node.height}px`,
                  }}
                  disabled={props.busy}
                  onPointerDown={(event) => onNodePointerDown(node, event)}
                  onClick={(event) => {
                    // Keep click for keyboard/accessibility; selection already done on pointerdown.
                    event.stopPropagation();
                    event.preventDefault();
                  }}
                >
                  <span class="branches-flow-node__kind-row">
                    <span class="branches-flow-node__kind">
                      {nodeKindLabel(node.kind, node.onActivePath)}
                    </span>
                    <span class="branches-flow-node__badges">
                      <Show when={node.kind === "compaction" || node.tags?.includes("压缩")}>
                        <span class="branches-flow-node__tag branches-flow-node__tag--compaction">
                          <Layers2 size={10} />
                          压缩
                        </span>
                      </Show>
                      <Show when={!node.onActivePath}>
                        <span class="branches-flow-node__left-badge">已离开</span>
                      </Show>
                      <Show when={node.isFork}>
                        <span
                          class="branches-flow-node__fork-badge"
                          title={`${node.childCount} 条分叉路径`}
                        >
                          <GitFork size={11} />
                          <span>{node.childCount}</span>
                        </span>
                      </Show>
                    </span>
                  </span>
                  <span class="branches-flow-node__label">{node.label}</span>
                </button>
              )}
            </For>
          </div>
        </div>

        <Show when={selected()} keyed>
          {(node) => (
            <div
              class="branches-flow-preview"
              style={previewStyle() ?? undefined}
              onPointerDown={(event) => {
                event.stopPropagation();
                ignoreBackgroundClear = true;
              }}
            >
              <div class="branches-flow-preview__head">
                <strong>{nodeKindLabel(node.kind, node.onActivePath)}</strong>
                <Show when={node.kind === "compaction"}>
                  <span class="branches-flow-preview__badge branches-flow-preview__badge--compaction">
                    <Layers2 size={11} />
                    压缩
                  </span>
                </Show>
                <Show when={node.onActivePath}>
                  <span class="branches-flow-preview__badge">当前路径</span>
                </Show>
                <Show when={!node.onActivePath}>
                  <span class="branches-flow-preview__badge branches-flow-preview__badge--left">
                    已离开
                  </span>
                </Show>
                <Show when={node.isFork}>
                  <span class="branches-flow-preview__badge branches-flow-preview__badge--fork">
                    <GitFork size={11} />
                    分叉 · {node.childCount}
                  </span>
                </Show>
              </div>
              <p class="branches-flow-preview__body">
                {node.kind === "compaction"
                  ? compactGraphPreview(node)
                  : node.preview}
              </p>
              <div class="branches-flow-preview__actions">
                <Button variant="secondary" onClick={() => selectNode(null)}>
                  关闭
                </Button>
                <Show when={node.onActivePath}>
                  <Button
                    variant="primary"
                    onClick={() => {
                      const id = node.id;
                      selectNode(null);
                      props.onGoto(id);
                    }}
                  >
                    {node.kind === "compaction" ? "跳到时间线" : "跳到消息"}
                  </Button>
                </Show>
                <Show when={!node.onActivePath && node.kind === "user"}>
                  <p class="branches-flow-preview__hint">在下方切换到此旁支，可继续聊</p>
                </Show>
                <Show when={!node.onActivePath && node.kind === "turn_summary"}>
                  <p class="branches-flow-preview__hint">
                    旧模型回合；若要续聊，先切到其上的旁支 user
                  </p>
                </Show>
                <Show when={!node.onActivePath && node.kind === "compaction"}>
                  <p class="branches-flow-preview__hint">
                    旁支压缩点；Request / Response 详情在时间线卡片中查看
                  </p>
                </Show>
                <Show when={node.onActivePath && node.kind === "compaction"}>
                  <p class="branches-flow-preview__hint">
                    详情（Request / Response）在聊天时间线的压缩卡片中展开
                  </p>
                </Show>
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

function clampScale(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function nodeKindLabel(
  kind: LaidOutBranchNode["kind"],
  onActivePath: boolean,
): string {
  if (kind === "user") return onActivePath ? "你" : "旁支";
  if (kind === "compaction") return "压缩";
  return onActivePath ? "回复" : "旧回复";
}

/** One-line graph hint — full request/response lives on the timeline card. */
function compactGraphPreview(node: LaidOutBranchNode): string {
  const tok = node.compaction?.tokensBefore;
  const tokLabel = tok != null ? `${Math.round(tok / 1000)}k tok` : "context";
  return `上下文压缩 · ${tokLabel}。展开时间线中的压缩卡片查看 Request / Response。`;
}
