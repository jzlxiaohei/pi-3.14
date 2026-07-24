import { Select as ArkSelect, createListCollection } from "@ark-ui/solid/select";
import { Check, ChevronDown } from "lucide-solid";
import { createMemo } from "solid-js";
import { Index, Portal } from "solid-js/web";

export type SelectOption = {
  disabled?: boolean;
  label: string;
  value: string;
};

type SelectProps = {
  class?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  value: string | null;
};

/**
 * Orbit select on Ark Select.
 * Content is Portalled (required inside Dialog / overflow:hidden surfaces).
 */
export function Select(props: SelectProps) {
  const collection = createMemo(() =>
    createListCollection({
      items: props.options,
      itemToValue: (item) => item.value,
      itemToString: (item) => item.label,
      isItemDisabled: (item) => Boolean(item.disabled),
    }),
  );

  return (
    <ArkSelect.Root
      class={`orbit-select ${props.class ?? ""}`.trim()}
      collection={collection()}
      disabled={props.disabled}
      positioning={{
        gutter: 4,
        placement: "bottom-start",
        strategy: "fixed",
      }}
      value={props.value ? [props.value] : []}
      onValueChange={(details) => {
        const next = details.value[0];
        if (next) props.onValueChange(next);
      }}
    >
      <ArkSelect.Control class="orbit-select__control">
        <ArkSelect.Trigger class="orbit-select__trigger">
          <ArkSelect.ValueText
            class="orbit-select__value"
            placeholder={props.placeholder ?? "Select"}
          />
          <ArkSelect.Indicator class="orbit-select__indicator">
            <ChevronDown size={12} />
          </ArkSelect.Indicator>
        </ArkSelect.Trigger>
      </ArkSelect.Control>
      <Portal>
        <ArkSelect.Positioner class="orbit-select__positioner">
          <ArkSelect.Content class="orbit-select__content">
            <Index each={collection().items}>
              {(item) => (
                <ArkSelect.Item class="orbit-select__item" item={item()}>
                  <ArkSelect.ItemText class="orbit-select__item-text">
                    {item().label}
                  </ArkSelect.ItemText>
                  <ArkSelect.ItemIndicator class="orbit-select__item-indicator">
                    <Check size={12} />
                  </ArkSelect.ItemIndicator>
                </ArkSelect.Item>
              )}
            </Index>
          </ArkSelect.Content>
        </ArkSelect.Positioner>
      </Portal>
    </ArkSelect.Root>
  );
}
