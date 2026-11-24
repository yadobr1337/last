import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "ui-button",
  {
    variants: {
      variant: {
        primary: "ui-button-primary",
        ghost: "ui-button-ghost",
        danger: "ui-button-danger",
      },
      size: {
        sm: "ui-button-sm",
        md: "ui-button-md",
        lg: "ui-button-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function ButtonLink({
  className, variant, size, ...props
}: React.ComponentProps<typeof Link> & VariantProps<typeof buttonVariants>) {
  return <Link className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function IconButton({ label, className, ...props }: ButtonProps & { label: string }) {
  return (
    <Button variant="ghost" type="button" className={cn("ui-icon-button", className)}
      aria-label={label} title={label} {...props} />
  );
}
