import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("mh-field", className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("ground-input ground-question w-full resize-none", className)}
      {...props}
    />
  );
}

export function SearchInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "mh-field pl-9",
        "bg-[color-mix(in_srgb,var(--color-surface)_90%,var(--color-subtle))]",
        className,
      )}
      {...props}
    />
  );
}
