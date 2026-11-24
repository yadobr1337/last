"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

export function PendingButton(props: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button {...props} aria-busy={pending} disabled={pending || props.disabled}>
      {pending ? <><span className="ui-spinner" aria-hidden="true" /> Выполняется…</> : props.children}
    </Button>
  );
}
