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
  const [showPw, setShowPw] = useState(false);
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
    <div className="relative grid min-h-screen grid-rows-[1fr_auto] bg-bg">
      {/* Brand mark — top-left, mirrors the sidebar header. */}
      <Link
        href="/"
        className="absolute left-6 top-6 flex items-center gap-2 text-sm font-semibold text-text"
      >
        <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-white">
          T
        </span>
        TradeMaster
      </Link>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mb-8 text-sm text-text-mute">
            Sign in to your AI trading firm.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-[11px] uppercase tracking-widest text-text-mute">
                Email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                placeholder="you@firm.com"
                className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2.5 text-sm outline-none focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="flex items-baseline justify-between text-[11px] uppercase tracking-widest text-text-mute">
                Password
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="normal-case tracking-normal text-text-mute hover:text-text"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </span>
              <input
                type={showPw ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2.5 text-sm outline-none focus:border-accent"
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
              className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3 text-[10px] uppercase tracking-widest text-text-mute">
            <span className="h-px flex-1 bg-border" />
            New to TradeMaster?
            <span className="h-px flex-1 bg-border" />
          </div>

          <Link
            href="/signup"
            className="mt-4 block w-full rounded-md border border-border bg-bg-elev-1 py-2.5 text-center text-sm font-medium text-text hover:border-accent/40"
          >
            Create an account
          </Link>
        </div>
      </div>

      <footer className="border-t border-border px-6 py-4 text-center text-[11px] text-text-mute">
        © {new Date().getFullYear()} TradeMaster · AI-orchestrated multi-model trading on Deriv
      </footer>
    </div>
  );
}
