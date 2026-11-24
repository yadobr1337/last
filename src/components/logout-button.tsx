"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function LogoutButton({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      className={className}
      onClick={async () => {
        await signOut({ callbackUrl: "/" });
      }}
      type="button"
    >
      Выйти
    </Button>
  );
}
