import { Link } from "@tanstack/react-router";
import { ContextShell } from "@/components/context-shell";

export function AskStub({ id }: { id: string }) {
  return (
    <ContextShell>
      <main className="mh-rise space-y-6 pb-16 pt-8">
        <p className="mh-eyebrow">Ask</p>
        <h1 className="mh-display text-4xl sm:text-5xl">Ask is next.</h1>
        <p className="mh-lede max-w-md">
          Typed questions over this context land in the next phase. Live session already searches
          what you brought.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/context/$id"
            params={{ id }}
            className="inline-flex h-11 items-center justify-center rounded-sm border border-line px-4 text-xs font-medium text-secondary hover:border-accent hover:text-fg"
          >
            Back to context
          </Link>
          <Link
            to="/context/$id/live"
            params={{ id }}
            className="mh-cta inline-flex items-center justify-center"
          >
            Start Live Session
          </Link>
        </div>
      </main>
    </ContextShell>
  );
}
