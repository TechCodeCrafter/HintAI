import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { MeetHintMark } from "@/components/meethint-mark";
import { MEETHINT_DOMAIN, MEETHINT_MARK, MEETHINT_NAME } from "@/lib/brand";

const TRUST_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/security", label: "Security" },
  { href: "/contact", label: "Contact" },
] as const;

export function TrustPageShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-[var(--hint-bg)] text-[var(--hint-text)]" data-testid="trust-page">
      <header className="border-b border-[var(--hint-border)]">
        <div className="hint-wrap flex items-center justify-between gap-6 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <MeetHintMark className="size-8" />
            <span className="text-[1.05rem] font-semibold tracking-tight">{MEETHINT_MARK}</span>
          </Link>
          <Link to="/home" className="text-sm text-[var(--hint-muted)] hover:text-[var(--hint-text)]">
            Open app
          </Link>
        </div>
      </header>

      <main className="hint-wrap max-w-3xl py-12">
        <p className="text-sm text-[var(--hint-muted)]">{MEETHINT_NAME}</p>
        <h1 className="hint-display mt-2 text-3xl sm:text-4xl">{title}</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-[var(--hint-muted)]">{description}</p>
        <article className="prose-trust mt-10 space-y-6 text-[15px] leading-relaxed text-[var(--hint-text)]">
          {children}
        </article>
      </main>

      <footer className="border-t border-[var(--hint-border)]">
        <div className="hint-wrap flex flex-col gap-4 py-8 text-[13px] text-[var(--hint-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>
            {MEETHINT_MARK} · {MEETHINT_DOMAIN}
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2" data-testid="trust-footer-nav">
            {TRUST_LINKS.map((link) => (
              <Link key={link.href} to={link.href} className="hover:text-[var(--hint-text)]">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

export { TRUST_LINKS };
