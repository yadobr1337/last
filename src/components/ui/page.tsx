import type { ReactNode } from "react";
import { Card } from "./card";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, children }: {
  title: string; description?: ReactNode; children?: ReactNode;
}) {
  return (
    <header className="ui-page-heading">
      <div className="min-w-0">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="ui-page-actions">{children}</div> : null}
    </header>
  );
}

export function SectionHeader({ title, description, children }: {
  title: string; description?: string; children?: ReactNode;
}) {
  return (
    <div className="ui-section-heading">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function StatCard({ label, value, icon, children, className }: {
  label: string; value: ReactNode; icon?: ReactNode; children?: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("ui-stat", className)}>
      <div className="ui-stat-label">{label}{icon}</div>
      <div className="ui-stat-value">{value}</div>
      {children ? <div className="ui-stat-detail">{children}</div> : null}
    </Card>
  );
}
