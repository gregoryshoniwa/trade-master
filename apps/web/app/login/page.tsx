"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.login(email.trim(), password);
      await refresh();
      router.replace("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "login failed");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-2xl border border-border bg-bg-card p-8 shadow-glow">
        <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
        <p className="mb-6 text-sm text-text-mute">
          Welcome back to your AI trading firm.
        </p>

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
              autoComplete="email"
              autoFocus
              className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-widest text-text-mute">
              Password
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
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
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-mute">
          New here?{" "}
          <Link href="/signup" className="text-bull hover:opacity-80">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
