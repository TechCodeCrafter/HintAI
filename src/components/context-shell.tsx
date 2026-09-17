import { Link } from "@tanstack/react-router";
import { AuthChrome } from "@/components/auth-chrome";
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
    <div className="enterprise-shell mh-page min-h-dvh text-fg">
      <header className="cockpit-glass-bar sticky top-0 z-30">
        <div className="enterprise-header-inner flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-5 sm:gap-7">
            <Link to="/home" className="enterprise-brand shrink-0 text-fg" aria-label="MeetHint home">
              <MeetHintMark className="size-9 sm:size-10" />
              <span className="brand-word">Hint</span>
            </Link>
            <nav className="hidden items-center gap-1 text-sm sm:flex" aria-label="Workspace navigation">
              <Link
                to="/home"
                className="rounded-lg px-3 py-2 text-secondary transition-colors hover:bg-hover hover:text-fg"
              >
                Home
              </Link>
              <Link
                to="/home"
                className="rounded-lg px-3 py-2 text-secondary transition-colors hover:bg-hover hover:text-fg"
              >
                Knowledge Spaces
              </Link>
              <Link
                to="/create"
                className="rounded-lg px-3 py-2 text-secondary transition-colors hover:bg-hover hover:text-fg"
              >
                New Space
              </Link>
            </nav>
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            {aside}
            <AuthChrome />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="enterprise-content">{children}</div>
    </div>
  );
}
