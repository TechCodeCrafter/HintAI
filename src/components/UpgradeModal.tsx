"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isPaidTier } from "@/lib/billing/subscription";
import { isWaitlistEmail } from "@/lib/billing/waitlist-email";
import { hasWaitlistSignup, joinProWaitlist } from "@/lib/billing/waitlist-local";
import { cn } from "@/lib/cn";
import { useMeetHint } from "@/lib/store";

const FEATURE_COPY: Record<string, { kicker: string; headline: string; reason: string }> = {
  audit: {
    kicker: "Claim Audit requires Pro",
    headline: "Track claims across the meeting",
    reason: "Claim Audit requires Pro. Upgrade to track and verify claims across meetings.",
  },
  "extract-limit": {
    kicker: "Today's question limit",
    headline: "Keep asking after today's 20",
    reason: "You've reached your daily limit. Upgrade to Pro for unlimited answers.",
  },
};

const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "",
    points: ["Auto-routed answers", "20 questions/day", "GPT-4o Mini", "1 pack"],
    action: "Current plan",
  },
  {
    name: "Pro",
    price: "$12",
    cadence: "/mo",
    points: ["Unlimited answers", "Claim Audit", "Model switching", "Export"],
    action: "Get early access",
    recommended: true,
  },
  {
    name: "Team",
    price: "$49",
    cadence: "/seat/mo",
    points: ["Everything in Pro", "Shared corpus", "Temporal contradiction"],
    action: "Contact us",
  },
] as const;

export function UpgradeModal({
  open,
  feature,
  onClose,
}: {
  open: boolean;
  feature: string | null;
  onClose: () => void;
}) {
  const titleId = useId();
  const emailId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const subscription = useMeetHint((s) => s.subscription);
  const copy = (feature && FEATURE_COPY[feature]) || FEATURE_COPY["extract-limit"];
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isWaitlistEmail(email);

  useEffect(() => {
    if (open && isPaidTier(subscription)) onClose();
  }, [open, subscription, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setSending(false);
      setError(null);
      return;
    }
    void hasWaitlistSignup().then((signed) => {
      if (signed) setDone(true);
    });
  }, [open]);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    const source = feature === "audit" ? "upgrade-audit" : "upgrade-synthesize";
    const result = await joinProWaitlist(email, source);
    setSending(false);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setDone(true);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 p-5 backdrop-blur-[2px]"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-[14px] border border-line bg-surface p-6 text-body shadow-lg md:p-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="upgrade-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 max-w-xl">
            <p className="text-[12px] font-medium uppercase text-accent">{copy.kicker}</p>
            <h2 id={titleId} className="mt-2 text-[1.65rem] font-semibold tracking-tight text-fg">
              {copy.headline}
            </h2>
            <p data-testid="upgrade-prompt" className="mt-3 text-[14px] leading-relaxed text-body">
              {copy.reason}
            </p>
          </div>
          <button
            type="button"
            data-testid="upgrade-close"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-secondary hover:bg-hover hover:text-fg"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {TIERS.map((tier) => {
            const recommended = "recommended" in tier && tier.recommended;
            return (
              <div
                key={tier.name}
                className={cn(
                  "flex min-h-0 flex-col rounded-[14px] border p-4",
                  recommended ? "border-accent-ring bg-accent-soft" : "border-line bg-bg",
                )}
              >
                {recommended ? (
                  <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-accent">
                    Recommended
                  </p>
                ) : (
                  <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-muted">
                    {tier.name}
                  </p>
                )}
                <p className="text-[13px] font-medium text-fg">{tier.name}</p>
                <p className="mt-1 text-[1.35rem] font-semibold tracking-tight text-fg">
                  {tier.price}
                  {tier.cadence ? (
                    <span className="text-[13px] font-medium text-muted">{tier.cadence}</span>
                  ) : null}
                </p>
                <ul className="mt-4 flex-1 space-y-2 text-[13px] text-body">
                  {tier.points.map((point) => (
                    <li key={point} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                {tier.name === "Pro" ? (
                  done ? (
                    <p className="mt-5 text-sm text-accent" data-testid="upgrade-waitlist-done" role="status">
                      Thanks, you're on the list
                    </p>
                  ) : (
                    <form className="mt-5 space-y-2" onSubmit={(event) => void submit(event)} noValidate>
                      <label className="sr-only" htmlFor={emailId}>
                        Email address
                      </label>
                      <input
                        ref={emailRef}
                        id={emailId}
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        data-testid="upgrade-email"
                        placeholder="you@company.com"
                        value={email}
                        onChange={(event) => {
                          setEmail(event.target.value);
                          if (error) setError(null);
                        }}
                        className="ground-input h-10 rounded-[10px] px-3 text-[13px]"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="w-full"
                        data-testid="upgrade-cta"
                        disabled={!valid || sending}
                      >
                        {sending ? "Saving…" : "Get early access"}
                      </Button>
                      {error ? <p className="text-xs text-bad">{error}</p> : null}
                    </form>
                  )
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-5 w-full"
                    disabled={tier.name === "Free"}
                    onClick={() => emailRef.current?.focus()}
                  >
                    {tier.action}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted">
          <p>Your files stay on your machine on every plan.</p>
          <p>Cancel anytime.</p>
        </div>
      </div>
    </div>
  );
}
