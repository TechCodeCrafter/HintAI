import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 active:scale-[0.98] select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent-hover",
        ghost: "bg-transparent text-secondary hover:bg-hover hover:text-fg",
        outline: "border border-line bg-transparent text-secondary hover:bg-hover hover:text-fg",
        quiet: "bg-transparent text-secondary hover:bg-hover hover:text-fg",
      },
      size: {
        sm: "h-9 px-3 text-[13px] rounded-[10px]",
        md: "h-10 px-4 text-[13px] rounded-[10px]",
        icon: "size-9 rounded-[10px]",
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
