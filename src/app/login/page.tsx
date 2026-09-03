"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function friendlyError(errorCode: string | null, description: string | null): string | null {
  if (!errorCode) return null;
  if (description) {
    // Supabase sends error_description as a URL-encoded, plus-separated string.
    return description.replace(/\+/g, " ");
  }
  if (errorCode === "auth") {
    return "We couldn't complete sign-in. Please try again.";
  }
  return `Sign-in failed (${errorCode}). Please try again.`;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const callbackError = friendlyError(
      searchParams.get("error") ?? searchParams.get("error_code"),
      searchParams.get("error_description")
    );
    if (callbackError) setError(callbackError);
  }, [searchParams]);

  const handleGitHubLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "github",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) {
        setError(authError.message);
        setLoading(false);
      }
      // On success, Supabase redirects the browser away from this page.
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unexpected error signing in. Please try again."
      );
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink px-6">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2 text-sm text-mute transition-colors hover:text-paper"
      >
        <span className="h-2 w-2 rounded-full bg-signal" aria-hidden="true" />
        Benve Control
      </Link>

      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal">
          Auditor Workspace
        </p>
        <h1 className="mt-3 font-display text-xl font-bold tracking-tight text-paper">
          Sign in to Benve Control
        </h1>
        <p className="mt-2 text-sm text-mute">
          Sign in with GitHub to access your organization&apos;s workspace.
        </p>

        <button
          onClick={handleGitHubLogin}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md border border-line bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-colors hover:border-signal disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            "Redirecting…"
          ) : (
            <>
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Sign in with GitHub
            </>
          )}
        </button>

        {error && (
          <p className="mt-4 rounded-md border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-left text-sm text-rose-300">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-ink">
          <span className="h-2 w-2 animate-pulse rounded-full bg-signal" aria-hidden="true" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
