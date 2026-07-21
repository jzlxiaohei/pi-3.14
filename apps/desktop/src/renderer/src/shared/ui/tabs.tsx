import { Tabs as ArkTabs } from "@ark-ui/solid/tabs";
import type { JSX } from "solid-js";
import { For, Show } from "solid-js";

export type TabItem = {
  badge?: string;
  content?: JSX.Element;
  icon?: JSX.Element;
  label: string;
  value: string;
};

type TabsProps = {
  items: TabItem[];
  onValueChange: (value: string) => void;
  value: string;
};

export function Tabs(props: TabsProps) {
  return (
    <ArkTabs.Root
      class="orbit-tabs"
      value={props.value}
      onValueChange={(details) => props.onValueChange(details.value)}
    >
      <ArkTabs.List class="orbit-tabs__list">
        <For each={props.items}>
          {(item) => (
            <ArkTabs.Trigger class="orbit-tabs__trigger" value={item.value}>
              {item.icon}
              {item.label}
              {item.badge ? <span class="orbit-tabs__badge">{item.badge}</span> : null}
            </ArkTabs.Trigger>
          )}
        </For>
      </ArkTabs.List>
      <For each={props.items}>
        {(item) => (
          <Show when={item.content}>
            <ArkTabs.Content class="orbit-tabs__content" value={item.value}>
              {item.content}
            </ArkTabs.Content>
          </Show>
        )}
      </For>
    </ArkTabs.Root>
  );
}
