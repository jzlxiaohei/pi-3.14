import type { JSX } from "solid-js";
import { Show, splitProps } from "solid-js";
import { Tooltip } from "./tooltip";

type IconButtonVariant = "ghost" | "primary" | "danger";
type IconButtonSize = "sm" | "md";

type IconButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  label: string;
  /**
   * Tooltip mode:
   * - omit / true → Orbit Tooltip from `label` (default)
   * - "native" → browser `title` only
   * - false → no tooltip (caller wraps Tooltip, or intentionally bare)
   */
  tooltip?: boolean | "native";
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** @deprecated Use `tooltip={false}` or `tooltip="native"`. */
  nativeTooltip?: boolean;
};

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, [
    "active",
    "children",
    "class",
    "classList",
    "label",
    "nativeTooltip",
    "tooltip",
    "size",
    "variant",
  ]);
  const variant = () => local.variant ?? "ghost";
  const size = () => local.size ?? "md";
  const tooltipMode = (): boolean | "native" => {
    if (local.tooltip !== undefined) return local.tooltip;
    if (local.nativeTooltip === false) return false;
    if (local.nativeTooltip === true) return "native";
    return true;
  };

  const button = () => (
    <button
      {...rest}
      aria-label={local.label}
      title={tooltipMode() === "native" ? local.label : undefined}
      class="icon-button"
      data-active={local.active ? "true" : undefined}
      classList={{
        [`icon-button--${variant()}`]: true,
        [`icon-button--${size()}`]: true,
        [local.class ?? ""]: Boolean(local.class),
        ...local.classList,
      }}
    >
      {local.children}
    </button>
  );

  return (
    <Show when={tooltipMode() === true} fallback={button()}>
      <Tooltip label={local.label}>{button()}</Tooltip>
    </Show>
  );
}
