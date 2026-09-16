import { Link } from "@tanstack/react-router";
import { Check, Circle } from "lucide-react";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { summarizeBetaFunnel, summarizeBetaLifecycle } from "@/lib/instrumentation/beta-telemetry";
import { useMeetHint } from "@/lib/store";

const STEPS = [
  { key: "sign-in", label: "Sign in", href: "/login" },
  { key: "space", label: "Create Knowledge Space", href: "/create" },
  { key: "sources", label: "Add repo, folder, or PDF", href: "/create" },
  { key: "index", label: "Wait for indexing", href: null },
  { key: "ask", label: "Ask a test question", href: null },
  { key: "live", label: "Start Live", href: null },
] as const;

export function BetaOnboardingChecklist({ spaceId }: { spaceId?: string }) {
  const { user, isPending } = useCurrentUserState();
  const contextStatus = useMeetHint((s) => s.contextStatus);
  const sources = useMeetHint((s) => s.sources.length);
  const funnel = summarizeBetaFunnel();
  const signedIn = !authEnabled || (!isPending && Boolean(user));
  const hasSpace = funnel.steps.some((row) => row.step === "SPACE_CREATED" && row.timestamp != null);
  const hasSources = funnel.steps.some((row) => row.step === "SOURCE_CONNECTED" && row.timestamp != null);
  const indexReady = contextStatus === "ready" && sources > 0;
  const asked = funnel.steps.some((row) => row.step === "FIRST_QUESTION" && row.timestamp != null);
  const liveStarted = summarizeBetaLifecycle().firstLiveSession > 0;
  const liveHref = spaceId ? `/context/${spaceId}/live` : null;
  const askHref = spaceId ? `/context/${spaceId}/ask` : null;

  const done = [signedIn, hasSpace, hasSources, indexReady, asked, liveStarted];

  if (done.every(Boolean)) return null;

  return (
    <section className="mh-panel space-y-4 p-5" data-testid="beta-onboarding">
      <div className="space-y-1">
        <p className="mh-eyebrow">Beta onboarding</p>
        <h2 className="text-lg font-semibold text-fg">Get ready for your first meeting</h2>
        <p className="text-sm text-muted">
          Live is the core experience — it listens during your call and cites your files. Use Ask to test search
          first, then go Live.
        </p>
      </div>
      <ol className="space-y-2">
        {STEPS.map((step, index) => {
          const complete = done[index];
          const Icon = complete ? Check : Circle;
          const content = (
            <span className="flex items-center gap-2 text-sm">
              <Icon aria-hidden className={`size-4 shrink-0 ${complete ? "text-ok" : "text-faint"}`} />
              {step.label}
            </span>
          );
          const stepAttrs = {
            "data-testid": `beta-onboarding-${step.key}`,
            "data-complete": complete ? "true" : "false",
          } as const;
          if (step.key === "ask" && askHref && indexReady) {
            return (
              <li key={step.key} {...stepAttrs}>
                <Link to={askHref} className="text-fg hover:text-accent">
                  {content}
                </Link>
              </li>
            );
          }
          if (step.key === "live" && liveHref && indexReady) {
            return (
              <li key={step.key} {...stepAttrs}>
                <Link to={liveHref} data-testid="beta-onboarding-live" className="text-fg hover:text-accent">
                  {content}
                </Link>
              </li>
            );
          }
          if (step.href && !complete) {
            return (
              <li key={step.key} {...stepAttrs}>
                <Link to={step.href} className="text-fg hover:text-accent">
                  {content}
                </Link>
              </li>
            );
          }
          return (
            <li key={step.key} data-testid={`beta-onboarding-${step.key}`} data-complete={complete ? "true" : "false"}>
              {content}
            </li>
          );
        })}
      </ol>
      {spaceId && indexReady ? (
        <p className="text-xs text-muted">
          Active Knowledge Space will be searched in Ask and Live sessions.
        </p>
      ) : null}
    </section>
  );
}

export function BetaSearchScopeNote({ spaceName, sourceCount, ready }: { spaceName: string; sourceCount: number; ready: boolean }) {
  return (
    <p className="text-xs text-muted" data-testid="beta-search-scope">
      {ready
        ? `${sourceCount} source${sourceCount === 1 ? "" : "s"} indexed in “${spaceName}”.`
        : `Indexing “${spaceName}” — Ask and Live unlock when sources are ready.`}
    </p>
  );
}
