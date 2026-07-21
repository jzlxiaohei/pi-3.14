import type { JSX } from "solid-js";
import { splitProps } from "solid-js";

type ButtonVariant = "primary" | "secondary" | "ghost";

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["class", "classList", "variant"]);
  const variant = () => local.variant ?? "secondary";

  return (
    <button
      {...rest}
      class="button"
      classList={{
        [`button--${variant()}`]: true,
        [local.class ?? ""]: Boolean(local.class),
        ...local.classList
      }}
    />
  );
}
