import { AlertCircle, GitFork, Layers2 } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { SessionMapStructureGraph } from "../../../../../shared/desktop-contracts";
import {
  layoutSessionMap,
  pointsToPath,
  type LaidOutSessionMapGraph,
  type LaidOutSessionMapNode,
} from "./session-map-layout";

export type SessionMapCanvasSelection = LaidOutSessionMapNode;

type SessionMapCanvasProps = {
  graph: SessionMapStructureGraph;
  busy?: boolean;
  selectedId: string | null;
  onSelect: (node: SessionMapCanvasSelection | null) => void;
};

type Viewport = { x: number; y: number; scale: number };

const MIN_SCALE = 0.28;
const MAX_SCALE = 2.2;

export function SessionMapCanvas(props: SessionMapCanvasProps) {
  const laidOut = createMemo(() => layoutSessionMap(props.graph));
  const [viewport, setViewport] = createSignal<Viewport>({ x: 24, y: 24, scale: 1 });
  const [dragging, setDragging] = createSignal(false);
  let hostRef: HTMLDivElement | undefined;
  let dragOrigin: { x: number; y: number; vx: number; vy: number } | null = null;
  let movedDuringDrag = false;
  let ignoreBackgroundClear = false;
  let resizeObserver: ResizeObserver | undefined;
  let prevGraph: SessionMapStructureGraph | undefined;

  const bindHost = (el: HTMLDivElement) => {
    hostRef = el;
    resizeObserver?.disconnect();
    resizeObserver = new ResizeObserver(() => {
      /* keep viewport */
    });
    resizeObserver.observe(el);
  };

  createEffect(() => {
    const graph = props.graph;
    if (prevGraph !== graph) {
      prevGraph = graph;
      const laid = laidOut();
      queueMicrotask(() => fitView(laid.width, laid.height));
    }
  });

  function fitView(worldW: number, worldH: number): void {
    const host = hostRef;
    if (!host || worldW <= 0 || worldH <= 0) return;
    const pad = 48;
    const sx = (host.clientWidth - pad) / worldW;
    const sy = (host.clientHeight - pad) / worldH;
    const scale = clampScale(Math.min(sx, sy, 1), MIN_SCALE, MAX_SCALE);
    setViewport({
      scale,
      x: (host.clientWidth - worldW * scale) / 2,
      y: Math.max(16, (host.clientHeight - worldH * scale) / 2),
    });
  }

  function revealSelection(): void {
    const id = props.selectedId;
    const host = hostRef;
    if (!id || !host) return;
    const node = laidOut().nodes.find((n) => n.id === id);
    if (!node) return;
    const vp = viewport();
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    setViewport({
      scale: vp.scale,
      x: host.clientWidth / 2 - cx * vp.scale,
      y: host.clientHeight / 2 - cy * vp.scale,
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
    if (target?.closest(".session-map-node, .session-map-minimap")) return;
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
    if (!panned && !ignoreBackgroundClear) {
      props.onSelect(null);
    }
    ignoreBackgroundClear = false;
  }

  function selectNode(node: LaidOutSessionMapNode, event: PointerEvent): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    movedDuringDrag = false;
    ignoreBackgroundClear = true;
    props.onSelect(node);
  }

  /** Minimap: pan main viewport so world point maps under click. */
  function panFromMinimap(nx: number, ny: number): void {
    const host = hostRef;
    const laid = laidOut();
    if (!host || laid.width <= 0) return;
    const vp = viewport();
    setViewport({
      scale: vp.scale,
      x: host.clientWidth / 2 - nx * laid.width * vp.scale,
      y: host.clientHeight / 2 - ny * laid.height * vp.scale,
    });
  }

  onCleanup(() => {
    dragOrigin = null;
    resizeObserver?.disconnect();
  });

  // Expose fit/reveal via custom events on host for toolbar buttons
  createEffect(() => {
    const host = hostRef;
    if (!host) return;
    const onFit = () => {
      const g = laidOut();
      fitView(g.width, g.height);
    };
    const onReveal = () => revealSelection();
    host.addEventListener("session-map-fit", onFit);
    host.addEventListener("session-map-reveal", onReveal);
    onCleanup(() => {
      host.removeEventListener("session-map-fit", onFit);
      host.removeEventListener("session-map-reveal", onReveal);
    });
  });

  return (
    <div
      class="session-map-canvas"
      classList={{ "session-map-canvas--dragging": dragging() }}
      ref={bindHost}
      data-session-map-canvas
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Show when={laidOut().nodes.length === 0}>
        <p class="session-map-empty">暂无会话结构</p>
      </Show>
      <Show when={laidOut().nodes.length > 0}>
        <div
          class="session-map-world"
          style={{
            width: `${laidOut().width}px`,
            height: `${laidOut().height}px`,
            transform: `translate(${viewport().x}px, ${viewport().y}px) scale(${viewport().scale})`,
          }}
        >
          <svg
            class="session-map-edges"
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
                    "session-map-edge": true,
                    "session-map-edge--active": edge.onActivePath,
                  }}
                />
              )}
            </For>
          </svg>
          <div class="session-map-nodes">
            <For each={laidOut().nodes}>
              {(node) => (
                <button
                  type="button"
                  class="session-map-node"
                  classList={{
                    "session-map-node--turn": node.kind === "turn",
                    "session-map-node--user": node.kind === "user",
                    "session-map-node--assistant": node.kind === "assistant",
                    "session-map-node--tool": node.kind === "toolResult",
                    "session-map-node--compaction": node.kind === "compaction",
                    "session-map-node--meta":
                      node.kind === "metadata" ||
                      node.kind === "unknown" ||
                      node.kind === "branchSummary" ||
                      node.kind === "customMessage",
                    "session-map-node--active": node.onActivePath,
                    "session-map-node--side": !node.onActivePath,
                    "session-map-node--fork": node.isFork,
                    "session-map-node--selected": props.selectedId === node.id,
                    "session-map-node--error": Boolean(node.hasError),
                  }}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.width}px`,
                    height: `${node.height}px`,
                  }}
                  disabled={props.busy}
                  onPointerDown={(event) => selectNode(node, event)}
                  onClick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                  }}
                >
                  <span class="session-map-node__kind-row">
                    <span class="session-map-node__kind">{node.label}</span>
                    <span class="session-map-node__badges">
                      <Show when={node.kind === "compaction"}>
                        <span class="session-map-node__tag">
                          <Layers2 size={10} />
                          压缩
                        </span>
                      </Show>
                      <Show when={!node.onActivePath}>
                        <span class="session-map-node__tag session-map-node__tag--side">旁支</span>
                      </Show>
                      <Show when={node.isFork}>
                        <span class="session-map-node__tag session-map-node__tag--fork">
                          <GitFork size={10} />
                          {node.childCount}
                        </span>
                      </Show>
                      <Show when={node.hasError}>
                        <span class="session-map-node__tag session-map-node__tag--error">
                          <AlertCircle size={10} />
                        </span>
                      </Show>
                    </span>
                  </span>
                  <span class="session-map-node__preview">{node.preview}</span>
                  <Show when={node.subtitle}>
                    <span class="session-map-node__sub">{node.subtitle}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </div>
        <SessionMapMinimap
          laidOut={laidOut()}
          viewport={viewport()}
          host={hostRef}
          onPan={panFromMinimap}
        />
      </Show>
    </div>
  );
}

function SessionMapMinimap(props: {
  laidOut: LaidOutSessionMapGraph;
  viewport: Viewport;
  host: HTMLDivElement | undefined;
  onPan: (nx: number, ny: number) => void;
}) {
  const dims = createMemo(() => {
    const w = 132;
    const h = 96;
    const gw = Math.max(props.laidOut.width, 1);
    const gh = Math.max(props.laidOut.height, 1);
    const scale = Math.min(w / gw, h / gh);
    return { w, h, scale, gw, gh };
  });

  const viewRect = createMemo(() => {
    const host = props.host;
    const d = dims();
    if (!host) return null;
    const vp = props.viewport;
    // world coords of host viewport corners
    const left = -vp.x / vp.scale;
    const top = -vp.y / vp.scale;
    const width = host.clientWidth / vp.scale;
    const height = host.clientHeight / vp.scale;
    return {
      x: left * d.scale,
      y: top * d.scale,
      w: width * d.scale,
      h: height * d.scale,
    };
  });

  function onMinimapPointer(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const d = dims();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    // Content is centered in minimap box
    const contentW = d.gw * d.scale;
    const contentH = d.gh * d.scale;
    const ox = (d.w - contentW) / 2;
    const oy = (d.h - contentH) / 2;
    const nx = (mx - ox) / contentW;
    const ny = (my - oy) / contentH;
    props.onPan(Math.min(1, Math.max(0, nx)), Math.min(1, Math.max(0, ny)));
  }

  return (
    <div
      class="session-map-minimap"
      style={{ width: `${dims().w}px`, height: `${dims().h}px` }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onMinimapPointer(event);
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 1) return;
        onMinimapPointer(event);
      }}
    >
      <svg width={dims().w} height={dims().h} aria-hidden="true">
        <g
          transform={`translate(${(dims().w - dims().gw * dims().scale) / 2}, ${(dims().h - dims().gh * dims().scale) / 2})`}
        >
          <For each={props.laidOut.edges}>
            {(edge) => (
              <path
                d={pointsToPath(edge.points.map((p) => ({ x: p.x * dims().scale, y: p.y * dims().scale })))}
                classList={{
                  "session-map-minimap__edge": true,
                  "session-map-minimap__edge--active": edge.onActivePath,
                }}
              />
            )}
          </For>
          <For each={props.laidOut.nodes}>
            {(node) => (
              <rect
                x={node.x * dims().scale}
                y={node.y * dims().scale}
                width={Math.max(2, node.width * dims().scale)}
                height={Math.max(2, node.height * dims().scale)}
                classList={{
                  "session-map-minimap__node": true,
                  "session-map-minimap__node--active": node.onActivePath,
                }}
                rx={1}
              />
            )}
          </For>
          <Show when={viewRect()}>
            {(r) => (
              <rect
                x={r().x}
                y={r().y}
                width={r().w}
                height={r().h}
                class="session-map-minimap__view"
              />
            )}
          </Show>
        </g>
      </svg>
    </div>
  );
}

function clampScale(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function dispatchSessionMapFit(host: HTMLElement | undefined): void {
  host?.dispatchEvent(new Event("session-map-fit"));
}

export function dispatchSessionMapReveal(host: HTMLElement | undefined): void {
  host?.dispatchEvent(new Event("session-map-reveal"));
}
