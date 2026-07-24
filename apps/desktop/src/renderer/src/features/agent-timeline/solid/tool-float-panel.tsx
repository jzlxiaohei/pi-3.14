import { X } from "lucide-solid";
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type JSX,
} from "solid-js";
import { Portal } from "solid-js/web";

type ToolFloatPanelProps = {
  open: boolean;
  title: string;
  /** Anchor row — used for placement and so re-clicks toggle instead of instant outside-dismiss. */
  getAnchor: () => HTMLElement | undefined;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
};

/**
 * Simple fixed float for tool details.
 * Avoids Ark Popover focus/dismiss races (expand inside used to close the panel and stick).
 */
export function ToolFloatPanel(props: ToolFloatPanelProps) {
  let panelRef: HTMLDivElement | undefined;
  const [tick, setTick] = createSignal(0);

  createEffect(() => {
    if (!props.open) return;
    setTick((n) => n + 1);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onOpenChange(false);
    };

    // Defer so the opening click does not count as an outside dismiss.
    let removePointer: (() => void) | undefined;
    const timer = window.setTimeout(() => {
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (!target) return;
        if (panelRef?.contains(target)) return;
        if (props.getAnchor()?.contains(target)) return;
        props.onOpenChange(false);
      };
      document.addEventListener("pointerdown", onPointerDown, true);
      removePointer = () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, 0);

    const onResize = () => setTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);

    onCleanup(() => {
      window.clearTimeout(timer);
      removePointer?.();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    });
  });

  const style = createMemo(() => {
    tick();
    if (!props.open) return {};
    const anchor = props.getAnchor();
    if (!anchor) {
      return {
        position: "fixed" as const,
        top: "72px",
        left: "24px",
        width: "min(480px, calc(100vw - 48px))",
        maxHeight: "min(64vh, 560px)",
      };
    }

    const rect = anchor.getBoundingClientRect();
    const width = Math.min(480, Math.max(280, window.innerWidth - 48));
    const maxHeight = Math.min(window.innerHeight * 0.64, 560);
    let left = rect.left - width - 10;
    if (left < 20) {
      left = Math.min(rect.right + 10, window.innerWidth - width - 20);
    }
    left = Math.max(20, Math.min(left, window.innerWidth - width - 20));
    let top = rect.top;
    if (top + maxHeight > window.innerHeight - 20) {
      top = Math.max(20, window.innerHeight - maxHeight - 20);
    }
    top = Math.max(20, top);

    return {
      position: "fixed" as const,
      top: `${Math.round(top)}px`,
      left: `${Math.round(left)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
    };
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          class="at-tool-float"
          style={style()}
          role="dialog"
          aria-modal="false"
          aria-label={props.title}
        >
          <header class="at-tool-float__header">
            <h2 class="at-tool-float__title">{props.title}</h2>
            <button
              type="button"
              class="at-tool-float__close"
              aria-label="Close"
              onClick={() => props.onOpenChange(false)}
            >
              <X size={13} />
            </button>
          </header>
          <div class="at-tool-float__body">{props.children}</div>
        </div>
      </Portal>
    </Show>
  );
}
