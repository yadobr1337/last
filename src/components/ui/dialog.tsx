"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import { Button, IconButton, type ButtonProps } from "./button";

export function Modal({ open, onClose, title, description, children, layout = "standard" }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  layout?: "standard" | "wide" | "drawer";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);

  return (
    <dialog ref={ref} className="ui-dialog" data-layout={layout} aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.target instanceof Element && event.target.closest("dialog") !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}>
      <div className="ui-dialog-panel">
        <header className="ui-dialog-header">
          <div className="min-w-0">
            <h2 id={headingId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </div>
          <IconButton label="Закрыть окно" onClick={onClose}><X size={20} aria-hidden="true" /></IconButton>
        </header>
        <div className="ui-dialog-content">{children}</div>
      </div>
    </dialog>
  );
}

export function ConfirmSubmit({ children, message, label = "Подтвердить", ...props }: Omit<ButtonProps, "type"> & {
  message: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLDivElement>(null);
  const { pending } = useFormStatus();
  return (
    <div className="inline-flex max-w-full" ref={trigger}>
      <Button {...props} type="button" disabled={pending || props.disabled}
        onClick={(event) => { if (event.currentTarget.form?.reportValidity()) setOpen(true); }}>
        {pending ? "Выполняется…" : children}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Подтвердите действие" description={message}>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
          <Button type="button" variant={props.variant} onClick={() => {
            const form = trigger.current?.closest("form");
            setOpen(false);
            form?.requestSubmit();
          }}>{label}</Button>
        </div>
      </Modal>
    </div>
  );
}
