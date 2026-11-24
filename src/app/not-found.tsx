import { Brand } from "@/components/brand";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="auth-page">
      <header className="obsidian-wrap auth-header"><Brand /></header>
      <main className="obsidian-wrap maintenance-page">
        <Card className="maintenance-card ui-reveal">
          <h1 className="text-3xl font-bold tracking-tight">Страница не найдена</h1>
          <p className="mt-3 text-muted">Проверьте адрес или вернитесь на главную.</p>
          <ButtonLink className="mt-6" href="/">На главную</ButtonLink>
        </Card>
      </main>
    </div>
  );
}
