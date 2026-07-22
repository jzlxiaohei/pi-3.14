import { Tooltip as ArkTooltip } from "@ark-ui/solid/tooltip";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";

type TooltipProps = {
  children: JSX.Element;
  label: string;
  openDelay?: number;
  positioning?: "top" | "bottom" | "left" | "right";
};

export function Tooltip(props: TooltipProps) {
  return (
    <ArkTooltip.Root
      lazyMount
      unmountOnExit
      openDelay={props.openDelay ?? 200}
      closeDelay={100}
      positioning={{ placement: props.positioning ?? "top", gutter: 6 }}
    >
      <ArkTooltip.Trigger
        asChild={(triggerProps) => (
          <span {...triggerProps()} class="orbit-tooltip__trigger">
            {props.children}
          </span>
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
