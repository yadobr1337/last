import Link from "next/link";
import { ShieldCheck } from "lucide-react";

export function Brand() {
  return (
    <Link href="/" prefetch={false} className="obsidian-brand" aria-label="1VPN — главная">
      <span className="brand-mark"><ShieldCheck size={20} aria-hidden="true" /></span>
      <span className="brand-name">1VPN <span className="brand-edition" aria-hidden="true">OBSIDIAN</span></span>
    </Link>
  );
}
