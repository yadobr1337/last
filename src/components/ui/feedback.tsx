import type { ReactNode } from "react";
import { CircleAlert, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="ui-empty"><Inbox aria-hidden="true" size={20} /><div>{children}</div></div>;
}

export function ErrorState({ children }: { children: ReactNode }) {
  return <div className="ui-callout" data-tone="danger" role="alert"><CircleAlert aria-hidden="true" size={19} /><div>{children}</div></div>;
}

export function Notice({ children, tone = "neutral", className }: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
}) {
  return <div className={cn("ui-callout", className)} data-tone={tone} role={tone === "danger" ? "alert" : "status"}>{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("ui-skeleton", className)} />;
}
