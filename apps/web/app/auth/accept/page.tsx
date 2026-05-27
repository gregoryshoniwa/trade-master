"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { api, ApiError, type InvitePeek } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function AcceptInner() {
  const search = useSearchParams();
  const router = useRouter();
  const { refresh, setActiveCompany, me } = useAuth();
  const token = search.get("token");

  const [peek, setPeek] = useState<InvitePeek | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoadError("missing token in URL");
      return;
    }
    api
      .peekInvite(token)
      .then(setPeek)
      .catch((e) =>
        setLoadError(e instanceof ApiError ? e.message : "invite not found"),
      );
  }, [token]);

  const isAlreadySignedIn = !!me;
  const needsAccountSetup = !isAlreadySignedIn;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api.acceptInvite({
        token,
        password: needsAccountSetup ? password : undefined,
        full_name: needsAccountSetup ? fullName : undefined,
      });
      if (r.company_id) setActiveCompany(r.company_id);
      await refresh();
      router.replace("/");
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : "accept failed");
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <div className="rounded-2xl border border-border bg-bg-card p-8">
          <h1 className="mb-2 text-lg font-semibold text-bear">Invite invalid</h1>
          <p className="mb-6 text-sm text-text-mute">{loadError}</p>
          <Link
            href="/login"
            className="rounded-md border border-border px-3 py-2 text-sm hover:border-bull"
          >
            Sign in instead →
          </Link>
        </div>
      </main>
    );
  }
  if (!peek) {
    return <main className="px-6 py-16 text-center text-sm text-text-mute">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <div className="rounded-2xl border border-border bg-bg-card p-8">
        <div className="mb-1 text-xs uppercase tracking-widest text-text-mute">
          You're invited to
        </div>
        <h1 className="mb-2 text-2xl font-semibold">{peek.company_name}</h1>
        <p className="mb-6 text-sm text-text-mute">
          As{" "}
          <span className="text-bull">
            {peek.role}
            {peek.title ? ` · ${peek.title}` : ""}
          </span>{" "}
          — invite addressed to <span className="text-text">{peek.email}</span>.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          {needsAccountSetup && (
            <>
              <Field label="Full name">
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
                  autoComplete="name"
                />
              </Field>
              <Field label="Choose a password">
                <input
                  type="password"
                  required
                  minLength={10}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
                  autoComplete="new-password"
                />
                <span className="mt-1 block text-[10px] text-text-mute">
                  10+ chars · mixed case · a digit
                </span>
              </Field>
            </>
          )}

          {submitError && (
            <div className="rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-bull py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Joining…" : `Join ${peek.company_name}`}
          </button>
        </form>

        {isAlreadySignedIn && (
          <p className="mt-3 text-center text-xs text-text-mute">
            Signed in as {me?.email}.
          </p>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
        {label}
      </span>
      {children}
    </label>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <main className="px-6 py-16 text-center text-sm text-text-mute">
          Loading…
        </main>
      }
    >
      <AcceptInner />
    </Suspense>
  );
}
