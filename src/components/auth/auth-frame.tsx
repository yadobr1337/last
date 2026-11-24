import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { OneVpnNetworkLogo } from "@/components/one-vpn-network-logo";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function AuthFrame({ title, description, children }: {
  title: string; description: string; children: ReactNode;
}) {
  return (
    <main className="auth-page">
      <header className="obsidian-wrap auth-header">
        <Brand />
        <ButtonLink href="/" variant="ghost" size="sm">На главную</ButtonLink>
      </header>
      <div className="obsidian-wrap auth-grid">
        <Card className="auth-card ui-reveal">
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="auth-card-body">{children}</div>
        </Card>
        <div className="auth-art ui-reveal ui-delay" aria-hidden="true">
          <OneVpnNetworkLogo />
        </div>
      </div>
    </main>
  );
}
