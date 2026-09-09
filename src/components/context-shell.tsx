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
      <header className="cockpit-glass-bar">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Link to="/home" className="flex items-center gap-3 text-fg">
            <MeetHintMark className="size-11" />
            <span className="brand-word">Hint</span>
          </Link>
          <div className="flex items-center gap-2">
            {aside}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">{children}</div>
    </div>
  );
}
