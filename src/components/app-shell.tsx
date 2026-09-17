import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Home,
  Menu,
  Radio,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { AuthChrome } from "@/components/auth-chrome";
import { MeetHintMark } from "@/components/meethint-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/cn";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  match: (path: string) => boolean;
};

const NAV: NavItem[] = [
  {
    to: "/home",
    label: "Home",
    icon: Home,
    match: (path) => path === "/home",
  },
  {
    to: "/home",
    label: "Knowledge Spaces",
    icon: BookOpen,
    match: (path) => path.startsWith("/context/") && !path.endsWith("/live"),
  },
  {
    to: "/app",
    label: "Live session",
    icon: Radio,
    match: (path) => path === "/app" || path.endsWith("/live"),
  },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <Link
            key={item.label}
            to={item.to}
            onClick={onNavigate}
            data-active={active ? "true" : "false"}
            className="app-nav-link"
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  children,
  aside,
  wide,
  topbar,
}: {
  children: ReactNode;
  aside?: ReactNode;
  wide?: boolean;
  topbar?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="Sidebar">
        <Link to="/home" className="app-sidebar-brand text-fg">
          <MeetHintMark className="size-9" />
          <span className="brand-word">Hint</span>
        </Link>
        <SidebarNav />
        <div className="mt-auto space-y-2 border-t border-line pt-4">
          <p className="px-2 text-[11px] leading-snug text-faint">Your knowledge, in the conversation.</p>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex size-10 items-center justify-center rounded-sm text-secondary hover:bg-hover hover:text-fg lg:hidden"
              aria-label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <Link to="/home" className="flex items-center gap-2 text-fg lg:hidden">
              <MeetHintMark className="size-8" />
              <span className="text-sm font-semibold">Hint</span>
            </Link>
            {topbar}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {aside ?? (
              <Link to="/app" className="hidden items-center gap-1.5 text-sm font-medium text-accent hover:text-fg sm:inline-flex">
                Start Live
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            )}
            <AuthChrome />
            <ThemeToggle />
          </div>
        </header>

        {mobileOpen ? (
          <div className="border-b border-line bg-nav px-3 py-3 lg:hidden">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        ) : null}

        <div className={cn("app-content", wide && "app-content-wide")} data-path={pathname}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function AppTopSearch({
  placeholder = "Search your knowledge or ask a question…",
}: {
  placeholder?: string;
}) {
  return (
    <label className="relative hidden min-w-0 flex-1 sm:block sm:max-w-md">
      <span className="sr-only">Search</span>
      <input
        readOnly
        placeholder={placeholder}
        className="mh-field w-full cursor-default bg-surface pr-16 text-sm text-muted"
        onFocus={(event) => event.currentTarget.blur()}
        aria-hidden
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">
        ⌘K
      </kbd>
    </label>
  );
}

export function QuickActionTile({
  title,
  description,
  icon,
  to,
  testId,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  to: string;
  testId?: string;
}) {
  return (
    <Link to={to} data-testid={testId} className="ds-action-tile group">
      <div className="space-y-1.5">
        <span className="text-accent [&_svg]:size-4">{icon}</span>
        <p className="ds-card-title">{title}</p>
        <p className="ds-caption">{description}</p>
      </div>
      <ArrowRight
        aria-hidden
        className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
      />
    </Link>
  );
}
