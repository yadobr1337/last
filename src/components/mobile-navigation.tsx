"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { useRef, type ReactNode } from "react";

type NavigationLink = { href: string; label: string; current?: boolean };

export function MobileNavigation({ links, children }: { links: NavigationLink[]; children?: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details className="mobile-menu" ref={menu} onKeyDown={(event) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }}>
      <summary aria-label="Меню навигации"><Menu size={22} aria-hidden="true" /></summary>
      <nav className="mobile-menu-panel" aria-label="Мобильное меню">
        {links.map((link) => (
          <Link href={link.href} key={link.href} prefetch={false} aria-current={link.current ? "page" : undefined}
            onClick={() => { if (menu.current) menu.current.open = false; }}>
            {link.label}
          </Link>
        ))}
        {children ? <div className="border-t border-line p-2 mt-1">{children}</div> : null}
      </nav>
    </details>
  );
}
