import { Dialog as ArkDialog } from "@ark-ui/solid/dialog";
import type { JSX } from "solid-js";
import { splitProps } from "solid-js";
import { Portal } from "solid-js/web";

type DialogProps = {
  children: JSX.Element;
  class?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** Accessible title for the dialog. */
  title: string;
};

/**
 * Orbit modal on Ark Dialog.
 * Backdrop/content are Portalled (official Ark pattern) so nested Select/Menu/Tooltip
 * layers stack correctly. Theme comes from `document.documentElement[data-theme]`.
 */
export function Dialog(props: DialogProps) {
  const [local, rest] = splitProps(props, ["children", "class", "onOpenChange", "open", "title"]);

  return (
    <ArkDialog.Root
      {...rest}
      lazyMount
      unmountOnExit
      open={local.open}
      onOpenChange={(details) => local.onOpenChange(details.open)}
    >
      <Portal>
        <ArkDialog.Backdrop class="orbit-dialog__backdrop" />
        <ArkDialog.Positioner class="orbit-dialog__positioner">
          <ArkDialog.Content class={`orbit-dialog__content ${local.class ?? ""}`.trim()}>
            <ArkDialog.Title class="orbit-dialog__sr-title">{local.title}</ArkDialog.Title>
            {local.children}
          </ArkDialog.Content>
        </ArkDialog.Positioner>
      </Portal>
    </ArkDialog.Root>
  );
}
