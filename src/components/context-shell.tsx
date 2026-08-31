import { Link } from "@tanstack/react-router";
import { MeetHintMark } from "@/components/meethint-mark";
import { ThemeToggle } from "@/components/theme-toggle";

export function ContextShell({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mh-page min-h-dvh text-fg">
      <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
        <header className="flex items-center justify-between gap-4 py-6">
          <Link to="/" className="flex items-center gap-2.5 text-fg">
            <MeetHintMark className="size-7" />
            <span className="brand-word text-sm">MEETHINT</span>
          </Link>
          <div className="flex items-center gap-2">
            {aside}
            <ThemeToggle />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
