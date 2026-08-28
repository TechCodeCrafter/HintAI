import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98] select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-ink shadow-glow hover:opacity-90",
        ghost: "border border-line bg-transparent text-secondary hover:border-accent hover:text-fg",
        outline: "border border-line bg-transparent text-secondary hover:border-accent hover:text-fg",
        quiet: "border border-line bg-transparent text-secondary hover:border-accent hover:text-fg",
      },
      size: {
        sm: "h-11 px-3 text-xs rounded-sm",
        md: "h-11 px-4 text-xs rounded-sm",
        icon: "size-11 rounded-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
