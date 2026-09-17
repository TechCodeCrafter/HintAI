"use client";

import { Navigate } from "@tanstack/react-router";
import { BookOpenCheck, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { MeetHintMark } from "@/components/meethint-mark";
import { AuthLoading } from "@/components/require-auth";
import { authClient, authEnabled, signIn, signInWithGoogle } from "@/lib/auth/client";
import { GROK_PROVIDERS } from "@/lib/auth/providers";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useClientMounted } from "@/lib/use-client-mounted";

const E2E_EMAIL_AUTH = import.meta.env.VITE_E2E === "true";

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
      <main className="grid min-h-dvh place-items-center p-6">
        <p className="text-sm text-muted">Sign-in is disabled in this environment.</p>
      </main>
    );
  }

  if (!mounted || isPending) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
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

  return (
    <main className="enterprise-login text-fg" data-testid="login-page">
      <nav className="enterprise-login-nav" aria-label="Sign in navigation">
        <a href="/" className="enterprise-brand text-fg" aria-label="MeetHint home">
          <MeetHintMark className="size-9" />
          <span className="brand-word">Hint</span>
        </a>
        <a href="/" className="enterprise-secondary hidden sm:inline-flex">
          Back to MeetHint
        </a>
      </nav>

      <div className="enterprise-login-grid">
        <section className="enterprise-login-copy space-y-7">
          <p className="enterprise-overline">Your knowledge. In the conversation.</p>
          <div className="space-y-5">
            <h1>Sign in to MeetHint</h1>
            <p className="max-w-xl text-[17px] leading-relaxed text-body sm:text-lg">
              Access your Knowledge Spaces, ask your material, and get answers that point back to the source.
            </p>
          </div>

          <div className="enterprise-trust-list space-y-5 pt-3">
            <TrustItem
              icon={<ShieldCheck className="size-5" />}
              title="Your material stays scoped"
              body="MeetHint searches the material available to your workspace and Knowledge Space."
            />
            <TrustItem
              icon={<BookOpenCheck className="size-5" />}
              title="Answers come with receipts"
              body="Supported answers show the file, section, line, or page used as evidence."
            />
            <TrustItem
              icon={<LockKeyhole className="size-5" />}
              title="Quiet when unsupported"
              body="If your material does not support an answer, MeetHint does not invent one."
            />
          </div>
        </section>

        <section className="enterprise-login-card" aria-labelledby="login-title">
          <div className="mx-auto max-w-md space-y-7">
            <div className="space-y-3 text-center">
              <MeetHintMark className="mx-auto size-12" />
              <div className="space-y-2">
                <h2 id="login-title" className="text-2xl font-semibold tracking-[-0.035em] text-fg">
                  Welcome back
                </h2>
                <p className="text-sm leading-relaxed text-muted">
                  {googleDirect
                    ? "Continue with Google to access your MeetHint workspace."
                    : "Continue with your configured provider to access your MeetHint workspace."}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {googleDirect ? (
                <button
                  type="button"
                  data-testid="login-oauth-google"
                  disabled={busy || !oauthReady}
                  onClick={() => {
                    setBusy(true);
                    void signInWithGoogle({ callbackURL: "/home" }).catch((err) => {
                      setError(err instanceof Error ? err.message : String(err));
                      setBusy(false);
                    });
                  }}
                  className="enterprise-login-provider w-full cursor-pointer border border-line bg-surface px-4 text-sm font-semibold text-fg hover:bg-subtle disabled:cursor-wait disabled:opacity-60"
                >
                  Continue with Google
                </button>
              ) : (
                GROK_PROVIDERS.map((provider) => (
                  <button
                    key={provider.providerId}
                    type="button"
                    data-testid={`login-oauth-${provider.providerId}`}
                    disabled={busy || !oauthReady}
                    onClick={() => {
                      setBusy(true);
                      void signIn(provider.providerId, { callbackURL: "/home" }).catch((err) => {
                        setError(err instanceof Error ? err.message : String(err));
                        setBusy(false);
                      });
                    }}
                    className="enterprise-login-provider w-full cursor-pointer border border-line bg-surface px-4 text-sm font-semibold text-fg hover:bg-subtle disabled:cursor-wait disabled:opacity-60"
                  >
                    Continue with {provider.label}
                  </button>
                ))
              )}
            </div>

            {E2E_EMAIL_AUTH ? (
              <form className="space-y-3 border-t border-line pt-5" onSubmit={submitEmail} data-testid="login-email-form">
                <p className="text-xs text-muted">Email sign-in (E2E builds only)</p>
                {mode === "sign-up" ? (
                  <input
                    type="text"
                    placeholder="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mh-field w-full px-3 text-sm"
                    data-testid="login-name"
                  />
                ) : null}
                <input
                  type="email"
                  required
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mh-field w-full px-3 text-sm"
                  data-testid="login-email"
                />
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mh-field w-full px-3 text-sm"
                  data-testid="login-password"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="enterprise-primary w-full disabled:opacity-60"
                  data-testid="login-email-submit"
                >
                  {mode === "sign-up" ? "Create account" : "Sign in with email"}
                </button>
                <button
                  type="button"
                  className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
                  onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
                >
                  {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
                </button>
              </form>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-bad/20 bg-bad/5 px-4 py-3 text-sm text-bad" role="alert" data-testid="login-error">
                {error}
              </p>
            ) : null}

            <p className="text-center text-xs leading-relaxed text-faint">
              Sign in only grants access to the material and Knowledge Spaces associated with your account.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function TrustItem({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="enterprise-trust-item">
      <span className="enterprise-trust-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="space-y-0.5">
        <p className="font-semibold text-fg">{title}</p>
        <p className="max-w-lg text-sm leading-relaxed text-muted">{body}</p>
      </div>
    </div>
  );
}
