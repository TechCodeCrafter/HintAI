"use client";

import { Link, Navigate } from "@tanstack/react-router";
import { FileText, Lock, Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { MeetHintMark } from "@/components/meethint-mark";
import { AuthLoading } from "@/components/require-auth";
import { Button } from "@/components/ui/button";
import { authClient, authEnabled, signIn, signInWithGoogle } from "@/lib/auth/client";
import { GROK_PROVIDERS } from "@/lib/auth/providers";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useClientMounted } from "@/lib/use-client-mounted";

const E2E_EMAIL_AUTH = import.meta.env.VITE_E2E === "true";

const TRUST_FEATURES = [
  {
    icon: Lock,
    title: "Secure by default",
    body: "Your account and Knowledge Spaces stay tied to you — no shared workspaces.",
  },
  {
    icon: FileText,
    title: "Local-first",
    body: "Material is read on your device and indexed locally. Nothing is uploaded.",
  },
  {
    icon: Shield,
    title: "Cited answers",
    body: "MeetHint speaks only when it can point to evidence in your material.",
  },
] as const;

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
    <main className="login-layout" data-testid="login-page">
      <section className="login-trust-panel">
        <div className="space-y-4">
          <p className="ds-overline">Your knowledge. In the conversation.</p>
          <h1 className="ds-display max-w-md">Sign in to MeetHint</h1>
          <p className="ds-body max-w-lg">
            Access your Knowledge Spaces, ask questions against your material, and get cited answers you can trust —
            securely and instantly.
          </p>
        </div>
        <ul className="space-y-5">
          {TRUST_FEATURES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="trust-feature">
              <span className="trust-feature-icon">
                <Icon aria-hidden className="size-4" />
              </span>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-fg">{title}</p>
                <p className="ds-caption">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="login-card-panel">
        <div className="login-card space-y-6">
          <div className="space-y-3 text-center">
            <MeetHintMark className="mx-auto size-12" />
            <h2 className="text-lg font-semibold text-fg">Welcome back</h2>
            <p className="text-sm text-muted">
              Sign in to access your MeetHint Knowledge Spaces.
            </p>
          </div>

          <div className="space-y-2">
            {googleDirect ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
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
                Continue with Google
              </Button>
            ) : (
              GROK_PROVIDERS.map((provider) => (
                <Button
                  key={provider.providerId}
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full"
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
                  Continue with {provider.label}
                </Button>
              ))
            )}
          </div>

          {E2E_EMAIL_AUTH ? (
            <form className="space-y-3 border-t border-line pt-4" onSubmit={submitEmail} data-testid="login-email-form">
              <p className="text-xs text-muted">Email sign-in (E2E builds only)</p>
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
              <Button type="submit" className="w-full" disabled={busy} data-testid="login-email-submit">
                {mode === "sign-up" ? "Create account" : "Sign in with email"}
              </Button>
              <button
                type="button"
                className="text-xs text-muted underline-offset-2 hover:underline"
                onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
              >
                {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </form>
          ) : null}

          {error ? (
            <p className="text-sm text-bad" role="alert" data-testid="login-error">
              {error}
            </p>
          ) : null}

          <p className="text-center text-xs text-muted">
            By signing in, you agree to our{" "}
            <Link to="/terms" className="text-accent hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="text-accent hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>
    </main>
  );
}
