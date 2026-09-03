"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isWaitlistEmail } from "@/lib/billing/waitlist-email";
import { hasWaitlistSignup, joinProWaitlist } from "@/lib/billing/waitlist-local";

const FEATURE_COPY: Record<string, string> = {
  synthesize:
    "Synthesize mode requires Pro. Upgrade to combine insights from multiple files with verified citations.",
  audit: "Claim Audit requires Pro. Upgrade to track and verify claims across meetings.",
};

const TIERS = [
  { name: "Free", price: "—", points: ["Extract only", "1 pack"] },
  {
    name: "Pro",
    price: "$12/mo",
    points: ["Extract + Synthesize + Claim Audit", "Unlimited packs", "Export"],
  },
  {
    name: "Team",
    price: "$49/seat/mo",
    points: ["Everything in Pro", "Temporal contradiction", "Shared corpus"],
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
  const reason = (feature && FEATURE_COPY[feature]) || FEATURE_COPY.synthesize;
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isWaitlistEmail(email);

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-bg/70 p-5" role="presentation" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-sm border border-line bg-surface p-5 text-body shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="upgrade-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-medium text-fg">
              Upgrade to Pro
            </h2>
            <p data-testid="upgrade-prompt" className="mt-2 text-xs leading-relaxed text-body">
              {reason}
            </p>
          </div>
          <button
            type="button"
            data-testid="upgrade-close"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-secondary hover:text-fg"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-sm border border-line">
          <div className="grid grid-cols-3 bg-subtle text-[11px] font-medium tracking-wide text-muted uppercase">
            {TIERS.map((tier) => (
              <div key={tier.name} className="border-r border-line px-3 py-2 last:border-r-0">
                <p className="text-fg">{tier.name}</p>
                <p className="mt-0.5 normal-case tracking-normal">{tier.price}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 text-xs text-body">
            {TIERS.map((tier) => (
              <ul key={tier.name} className="list-none border-r border-line px-3 py-3 last:border-r-0">
                {tier.points.map((point) => (
                  <li key={point} className="mt-1.5 first:mt-0">
                    {point}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        {done ? (
          <p className="mt-5 text-sm text-accent" data-testid="upgrade-waitlist-done" role="status">
            Thanks, you're on the list
          </p>
        ) : (
          <form className="mt-5 space-y-2" onSubmit={(event) => void submit(event)} noValidate>
            <label className="sr-only" htmlFor={emailId}>
              Email address
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
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
                className="min-h-11 min-w-0 flex-1 rounded-sm border border-line bg-input px-3 text-xs text-fg"
              />
              <Button
                type="submit"
                className="bg-blue-600 text-white hover:bg-blue-500"
                data-testid="upgrade-cta"
                disabled={!valid || sending}
              >
                {sending ? "Saving…" : "Get early access"}
              </Button>
            </div>
            {error ? <p className="text-xs text-bad">{error}</p> : null}
          </form>
        )}
      </div>
    </div>
  );
}
