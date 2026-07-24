import { ark } from "@ark-ui/solid/factory";
import { Tooltip as ArkTooltip } from "@ark-ui/solid/tooltip";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";

type TooltipProps = {
  children: JSX.Element;
  label: string;
  openDelay?: number;
  positioning?: "top" | "bottom" | "left" | "right";
};

/**
 * Orbit tooltip on Ark Solid.
 * Uses asChild + ark.span so callers can wrap a button (task sidebar) without button nesting.
 * Content is portalled (Ark Basic / Dialog-with-Tooltip pattern).
 */
export function Tooltip(props: TooltipProps) {
  return (
    <ArkTooltip.Root
      openDelay={props.openDelay ?? 200}
      closeDelay={100}
      positioning={{
        placement: props.positioning ?? "top",
        gutter: 6,
        strategy: "fixed",
      }}
    >
      <ArkTooltip.Trigger
        asChild={(triggerProps) => (
          <ark.span {...triggerProps({ class: "orbit-tooltip__trigger" })}>
            {props.children}
          </ark.span>
        )}
      />
      <Portal>
        <ArkTooltip.Positioner class="orbit-tooltip__positioner">
          <ArkTooltip.Content class="orbit-tooltip__content">{props.label}</ArkTooltip.Content>
        </ArkTooltip.Positioner>
      </Portal>
    </ArkTooltip.Root>
  );
}
