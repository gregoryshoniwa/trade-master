"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function VerifyInner() {
  const search = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const token = search.get("token");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setError("Missing token in URL");
      return;
    }
    (async () => {
      try {
        const r = await api.verifyMagicLink(token);
        await refresh();
        setDone(true);
        // Send new users to onboarding (create a company); returning users
        // to the chart.
        setTimeout(() => router.replace(r.is_new ? "/companies/new" : "/"), 500);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "verify failed");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-2xl border border-border bg-bg-card p-8 text-center">
        {error ? (
          <>
            <h1 className="mb-2 text-lg font-semibold text-bear">Sign-in failed</h1>
            <p className="text-sm text-text-mute">{error}</p>
            <a
              href="/login"
              className="mt-6 inline-block rounded-md border border-border px-3 py-2 text-sm hover:border-bull"
            >
              Try again
            </a>
          </>
        ) : done ? (
          <>
            <div className="mx-auto mb-3 h-8 w-8 rounded-full bg-bull shadow-glow" />
            <h1 className="text-lg font-semibold">Signed in</h1>
            <p className="mt-1 text-sm text-text-mute">Redirecting…</p>
          </>
        ) : (
          <p className="text-sm text-text-mute">Verifying…</p>
        )}
      </div>
    </main>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-center text-sm text-text-mute">Loading…</main>}>
      <VerifyInner />
    </Suspense>
  );
}
