type PanelResizeHandleProps = {
  label: string;
  max: number;
  min: number;
  onChange: (width: number) => void;
  /** left = task sidebar (drag right grows); right = inspector (drag left grows). */
  side: "left" | "right";
  value: number;
};

export function PanelResizeHandle(props: PanelResizeHandleProps) {
  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const handle = event.currentTarget as HTMLButtonElement;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = props.value;
    handle.setPointerCapture(event.pointerId);
    handle.dataset.dragging = "true";
    document.body.dataset.panelResizing = "true";

    function onPointerMove(move: PointerEvent) {
      const delta = move.clientX - startX;
      const next = props.side === "left" ? startWidth + delta : startWidth - delta;
      props.onChange(Math.round(Math.min(props.max, Math.max(props.min, next))));
    }

    function onPointerUp(up: PointerEvent) {
      handle.releasePointerCapture(up.pointerId);
      delete handle.dataset.dragging;
      delete document.body.dataset.panelResizing;
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
    }

    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  }

  return (
    <button
      type="button"
      class="panel-resize-handle"
      classList={{ "panel-resize-handle--right": props.side === "right" }}
      aria-label={props.label}
      onPointerDown={onPointerDown}
    >
      <span class="panel-resize-handle__indicator" />
    </button>
  );
}
