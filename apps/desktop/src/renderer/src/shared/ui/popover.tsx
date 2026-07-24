import { Popover as ArkPopover } from "@ark-ui/solid/popover";
import { X } from "lucide-solid";
import type { JSX } from "solid-js";
import { splitProps } from "solid-js";
import { Portal } from "solid-js/web";

type PopoverPlacement =
  | "right-start"
  | "left-start"
  | "bottom-start"
  | "top-start"
  | "right"
  | "left";

type PopoverProps = {
  /** Panel body. */
  children: JSX.Element;
  class?: string;
  /** Visible header + accessible title. */
  title: string;
  /** Label/content inside the trigger button. */
  trigger: JSX.Element;
  triggerClass?: string;
  placement?: PopoverPlacement;
  /** Controlled open (e.g. auto-open for tool approval). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Orbit popover on Ark Popover.
 * Content is Portalled so overflow:hidden ancestors do not clip it.
 */
export function Popover(props: PopoverProps) {
  const [local] = splitProps(props, [
    "children",
    "class",
    "title",
    "trigger",
    "triggerClass",
    "placement",
    "open",
    "onOpenChange",
  ]);

  return (
    <ArkPopover.Root
      open={local.open}
      positioning={{
        gutter: 10,
        placement: local.placement ?? "left-start",
        strategy: "fixed",
        // Keep the floating box inside the window (was clipping on the left edge).
        overflowPadding: 20,
        flip: true,
        slide: true,
        fitViewport: true,
      }}
      onOpenChange={(details) => local.onOpenChange?.(details.open)}
    >
      <ArkPopover.Trigger
        class={`orbit-popover__trigger ${local.triggerClass ?? ""}`.trim()}
      >
        {local.trigger}
      </ArkPopover.Trigger>
      <Portal>
        <ArkPopover.Positioner class="orbit-popover__positioner">
          <ArkPopover.Content
            class={`orbit-popover__content ${local.class ?? ""}`.trim()}
          >
            <header class="orbit-popover__header">
              <ArkPopover.Title class="orbit-popover__title">{local.title}</ArkPopover.Title>
              <ArkPopover.CloseTrigger class="orbit-popover__close" aria-label="Close">
                <X size={13} />
              </ArkPopover.CloseTrigger>
            </header>
            <div class="orbit-popover__body">{local.children}</div>
          </ArkPopover.Content>
        </ArkPopover.Positioner>
      </Portal>
    </ArkPopover.Root>
  );
}
