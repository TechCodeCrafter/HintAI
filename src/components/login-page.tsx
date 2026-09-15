"use client";

import { Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { MeetHintMark } from "@/components/meethint-mark";
import { authClient, authEnabled, signIn } from "@/lib/auth/client";
import { GROK_PROVIDERS } from "@/lib/auth/providers";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const E2E_EMAIL_AUTH = import.meta.env.VITE_E2E === "true";

export function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!authEnabled) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <p className="text-sm text-muted">Sign-in is disabled in this environment.</p>
      </main>
    );
  }

  if (isPending) {
    return (
      <main className="grid min-h-dvh place-items-center p-6" data-testid="auth-loading">
        <div className="h-8 w-8 animate-pulse rounded-full bg-black/10 dark:bg-white/15" aria-hidden />
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
    <main className="mh-page grid min-h-dvh place-items-center p-6">
      <div className="w-full max-w-sm space-y-6" data-testid="login-page">
        <div className="flex flex-col items-center gap-3 text-center">
          <MeetHintMark className="size-14" />
          <h1 className="text-xl font-semibold text-fg">Sign in to MeetHint</h1>
          <p className="text-sm text-muted">
            Use Google or X to create your account and access your Knowledge Spaces.
          </p>
        </div>

        <div className="space-y-2">
          {GROK_PROVIDERS.map((provider) => (
            <button
              key={provider.providerId}
              type="button"
              data-testid={`login-oauth-${provider.providerId}`}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void signIn(provider.providerId, { callbackURL: "/home" }).catch((err) => {
                  setError(err instanceof Error ? err.message : String(err));
                  setBusy(false);
                });
              }}
              className="w-full cursor-pointer rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
            >
              Continue with {provider.label}
            </button>
          ))}
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
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
                data-testid="login-name"
              />
            ) : null}
            <input
              type="email"
              required
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              data-testid="login-email"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              data-testid="login-password"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
              data-testid="login-email-submit"
            >
              {mode === "sign-up" ? "Create account" : "Sign in with email"}
            </button>
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
          <p className="text-sm text-danger" role="alert" data-testid="login-error">
            {error}
          </p>
        ) : null}
      </div>
    </main>
  );
}
