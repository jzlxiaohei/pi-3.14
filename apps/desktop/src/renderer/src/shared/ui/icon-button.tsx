import type { JSX } from "solid-js";
import { splitProps } from "solid-js";

type IconButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  label: string;
};

export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, ["active", "class", "classList", "label"]);

  return (
    <button
      {...rest}
      aria-label={local.label}
      title={local.label}
      class="icon-button"
      data-active={local.active ? "true" : undefined}
      classList={{
        [local.class ?? ""]: Boolean(local.class),
        ...local.classList
      }}
    />
  );
}
