"use client";

import Link from "next/link";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setLink(null);
    try {
      const r = await api.requestMagicLink(email.trim(), fullName.trim() || undefined);
      setLink(r.dev_link);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "request failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-2xl border border-border bg-bg-card p-8 shadow-glow">
        <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-text-mute">
          We&apos;ll email you a magic link. (Dev mode: it&apos;s shown below.)
        </p>

        {link ? (
          <div className="space-y-4">
            <div className="rounded-md border border-bull/30 bg-bull-soft p-4 text-sm">
              <div className="mb-2 font-medium text-bull">Magic link ready</div>
              <Link
                href={link.replace("http://localhost:3000", "")}
                className="break-all text-bull underline hover:opacity-80"
              >
                {link}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setLink(null)}
              className="text-sm text-text-mute hover:text-text"
            >
              ← request another
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-text-mute">
                Email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
                placeholder="you@example.com"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-widest text-text-mute">
                Full name (first-time signup)
              </span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
                placeholder="Gregory Shoniwa"
              />
            </label>

            {error && (
              <div className="rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-bull py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
