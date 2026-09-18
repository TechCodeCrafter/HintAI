"use client";

import { Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MeetHintMark } from "@/components/meethint-mark";
import { AuthLoading } from "@/components/require-auth";
import { authClient, authEnabled, signIn, signInWithGoogle } from "@/lib/auth/client";
import { GROK_PROVIDERS } from "@/lib/auth/providers";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useClientMounted } from "@/lib/use-client-mounted";

const E2E_EMAIL_AUTH = import.meta.env.VITE_E2E === "true";

/** The product, in one exchange. Rendered as a miniature live-answer panel. */
function ProductDemo() {
  return (
    <div className="login2-demo" aria-hidden="true">
      <div className="login2-demo-bar">
        <span className="login2-demo-live">
          <span className="login2-demo-dot" />
          Live session
        </span>
        <span className="login2-demo-meta">3 sources searched</span>
      </div>

      <div className="login2-demo-exchange">
        <div className="login2-demo-row">
          <span className="login2-demo-who">Customer</span>
          <p className="login2-demo-q">“Do you support Canadian data residency?”</p>
        </div>

        <div className="login2-demo-detected">
          <span className="login2-demo-detected-dot" />
          Question detected
        </div>

        <div className="login2-demo-answer">
          <p className="login2-demo-say-kicker">Say this</p>
          <p className="login2-demo-say">
            “Yes. Canadian workloads can remain within the Canada region when regional deployment is
            enabled.”
          </p>
          <div className="login2-demo-evidence">
            <span className="login2-demo-supported">
              <svg viewBox="0 0 12 12" className="login2-demo-check" aria-hidden="true">
                <path d="M2 6.5 4.7 9 10 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Supported · 2 sources
            </span>
            <ul className="login2-demo-cites">
              <li className="login2-demo-cite">
                <span className="login2-demo-cite-name">Security Architecture.pdf</span>
                <span className="login2-demo-cite-loc">Page 14</span>
              </li>
              <li className="login2-demo-cite">
                <span className="login2-demo-cite-name">Enterprise Deployment.md</span>
                <span className="login2-demo-cite-loc">Lines 84–97</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="login-google-icon" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function LoginPage() {
  const mounted = useClientMounted();
  const { user, isPending } = useCurrentUserState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleDirect, setGoogleDirect] = useState(false);
  const [oauthReady, setOauthReady] = useState(true);

  // The login page is always light — a calm, warm desk regardless of app theme.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.dataset.theme;
    root.dataset.theme = "light";
    root.style.colorScheme = "light";
    return () => {
      root.dataset.theme = prev ?? "";
      root.style.colorScheme = prev ?? "";
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { oauthReady?: boolean; googleDirect?: boolean; reason?: string } | null) => {
        if (cancelled || !data) return;
        setGoogleDirect(Boolean(data.googleDirect));
        setOauthReady(data.oauthReady !== false);
        if (data.oauthReady) return;
        if (data.reason === "missing-production-oauth-client") {
          setError(
            "Google sign-in is not configured for this domain yet. " +
              "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, " +
              "or register a meethint.ai OAuth client on auth.grok.me.",
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!authEnabled) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#fafafa] p-6">
        <p className="text-sm text-muted">Sign-in is disabled in this environment.</p>
      </main>
    );
  }

  if (!mounted || isPending) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#fafafa] p-6">
        <AuthLoading />
      </main>
    );
  }

  if (user) {
    return <Navigate to="/home" />;
  }

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "sign-up") {
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0] || "User",
        });
        if (signUpError) throw new Error(signUpError.message ?? "Sign-up failed");
      }
      const { error: signInError } = await authClient.signIn.email({ email, password });
      if (signInError) throw new Error(signInError.message ?? "Sign-in failed");
      window.location.href = "/home";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const oauthButtons = googleDirect ? (
    <button
      key="google"
      type="button"
      className="login-oauth"
      data-testid="login-oauth-google"
      disabled={busy || !oauthReady}
      onClick={() => {
        setBusy(true);
        void signInWithGoogle({ callbackURL: "/home" }).catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        });
      }}
    >
      <GoogleIcon />
      <span>{busy ? "Redirecting…" : "Continue with Google"}</span>
    </button>
  ) : (
    GROK_PROVIDERS.map((provider) => (
      <button
        key={provider.providerId}
        type="button"
        className="login-oauth"
        data-testid={`login-oauth-${provider.providerId}`}
        disabled={busy || !oauthReady}
        onClick={() => {
          setBusy(true);
          void signIn(provider.providerId, { callbackURL: "/home" }).catch((err) => {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
          });
        }}
      >
        <span>{busy ? "Redirecting…" : `Continue with ${provider.label}`}</span>
      </button>
    ))
  );

  return (
    <main className="login2" data-testid="login-page">
      <div className="login2-frame">
        {/* Brand / product panel */}
        <section className="login2-brand">
          <div className="login2-wordmark">
            <MeetHintMark className="login2-mark" />
            <span className="login2-name">MeetHint</span>
          </div>

          <div className="login2-hero">
            <h1 className="login2-headline">
              Know the answer before the moment&nbsp;passes.
            </h1>
            <p className="login2-sub">
              MeetHint listens to technical conversations and surfaces answers from your company’s
              actual knowledge — with the evidence to back them up.
            </p>
          </div>

          <ProductDemo />
        </section>

        {/* Auth panel */}
        <section className="login2-auth">
          <div className="login2-auth-inner">
            {/* Mobile identity — brand panel is hidden below 1024px */}
            <div className="login2-mobile-brand">
              <div className="login2-wordmark">
                <MeetHintMark className="login2-mark" />
                <span className="login2-name">MeetHint</span>
              </div>
              <h1 className="login2-mobile-headline">Know the answer before the moment passes.</h1>
            </div>

            <div className="login2-auth-head">
              <h2 className="login2-auth-title">Welcome back</h2>
              <p className="login2-auth-sub">Sign in to continue to MeetHint.</p>
            </div>

            <div className="login2-auth-actions">{oauthButtons}</div>

            {E2E_EMAIL_AUTH ? (
              <form className="login2-email" onSubmit={submitEmail} data-testid="login-email-form">
                <p className="login2-email-note">Email sign-in (E2E builds only)</p>
                {mode === "sign-up" ? (
                  <input
                    type="text"
                    placeholder="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mh-field"
                    data-testid="login-name"
                  />
                ) : null}
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mh-field"
                  data-testid="login-email"
                />
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mh-field"
                  data-testid="login-password"
                />
                <button type="submit" className="login2-email-submit" disabled={busy} data-testid="login-email-submit">
                  {mode === "sign-up" ? "Create account" : "Sign in with email"}
                </button>
                <button
                  type="button"
                  className="login2-email-toggle"
                  onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
                >
                  {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </form>
            ) : null}

            {error ? (
              <p className="login2-error" role="alert" data-testid="login-error">
                {error}
              </p>
            ) : null}

            <p className="login2-legal">
              By signing in, you agree to our{" "}
              <Link to="/terms" className="login2-legal-link">
                Terms
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="login2-legal-link">
                Privacy Policy
              </Link>
              .
            </p>

            {/* Compact product proof below auth on small screens */}
            <div className="login2-mobile-demo">
              <ProductDemo />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
