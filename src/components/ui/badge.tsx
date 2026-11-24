import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "ui-badge",
        className,
      )}
      {...props}
    />
  );
}

export function StatusBadge({
  tone = "neutral", className, children, ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "success" | "warning" | "danger" }) {
  return (
    <Badge className={cn("ui-status", className)} data-tone={tone} {...props}>
      <span aria-hidden="true" />
      {children}
    </Badge>
  );
}
