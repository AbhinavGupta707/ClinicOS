import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cx } from "./utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: ReactNode;
}

const variantClassName: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "ui-button ui-button--primary",
  secondary: "ui-button ui-button--secondary",
  ghost: "ui-button ui-button--ghost",
  danger: "ui-button ui-button--danger"
};

const sizeClassName: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "ui-button--sm",
  md: "ui-button--md"
};

export function Button({
  children,
  className,
  icon,
  size = "md",
  type = "button",
  variant = "secondary",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cx(variantClassName[variant], sizeClassName[size], className)}
      type={type}
      {...props}
    >
      {icon ? (
        <span className="ui-button__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
    </button>
  );
}
