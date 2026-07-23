import type { JSX } from "solid-js";
import { splitProps } from "solid-js";

type IconButtonVariant = "ghost" | "primary" | "danger";
type IconButtonSize = "sm" | "md";

type IconButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  label: string;
  nativeTooltip?: boolean;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
};

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, [
    "active",
    "class",
    "classList",
    "label",
    "nativeTooltip",
    "size",
    "variant",
  ]);
  const variant = () => local.variant ?? "ghost";
  const size = () => local.size ?? "md";

  return (
    <button
      {...rest}
      aria-label={local.label}
      title={local.nativeTooltip === false ? undefined : local.label}
      class="icon-button"
      data-active={local.active ? "true" : undefined}
      classList={{
        [`icon-button--${variant()}`]: true,
        [`icon-button--${size()}`]: true,
        [local.class ?? ""]: Boolean(local.class),
        ...local.classList
      }}
    />
  );
}
