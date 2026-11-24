import type { InputHTMLAttributes, ReactNode } from "react";

export function CheckField({ children, variant = "checkbox", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  children: ReactNode;
  variant?: "checkbox" | "switch";
}) {
  return (
    <label className={variant === "switch" ? "ui-switch" : "ui-check"}>
      <input type="checkbox" role={variant === "switch" ? "switch" : undefined} {...props} />
      {variant === "switch" ? <span aria-hidden="true" className="ui-switch-track" /> : null}
      <span>{children}</span>
    </label>
  );
}
