import { Collapsible as ArkCollapsible } from "@ark-ui/solid/collapsible";
import { ChevronRight } from "lucide-solid";
import type { JSX } from "solid-js";
import { Show } from "solid-js";

type CollapsibleProps = {
  children: JSX.Element;
  class?: string;
  description?: JSX.Element;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: JSX.Element;
  trailing?: JSX.Element;
};

export function Collapsible(props: CollapsibleProps) {
  return (
    <ArkCollapsible.Root
      class={`orbit-collapsible ${props.class ?? ""}`.trim()}
      open={props.open}
      onOpenChange={(details) => props.onOpenChange(details.open)}
    >
      <div class="orbit-collapsible__head">
        <ArkCollapsible.Trigger class="orbit-collapsible__trigger">
          <ArkCollapsible.Indicator class="orbit-collapsible__indicator">
            <ChevronRight size={13} />
          </ArkCollapsible.Indicator>
          <span>{props.title}</span>
        </ArkCollapsible.Trigger>
        <Show when={props.trailing}>
          <div class="orbit-collapsible__trailing">{props.trailing}</div>
        </Show>
      </div>
      <Show when={props.description}>
        <p class="orbit-collapsible__description">{props.description}</p>
      </Show>
      <ArkCollapsible.Content class="orbit-collapsible__content">
        {props.children}
      </ArkCollapsible.Content>
    </ArkCollapsible.Root>
  );
}
