"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SignupPage() {
  const router = useRouter();
  const { refresh, setActiveCompany } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.signup({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        company_name: companyName.trim() || undefined,
      });
      if (r.company_id) setActiveCompany(r.company_id);
      await refresh();
      router.replace(r.company_id ? "/" : "/companies/new");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "signup failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="relative grid min-h-screen grid-rows-[1fr_auto] bg-bg">
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
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Create your firm</h1>
          <p className="mb-8 text-sm text-text-mute">
            You&apos;ll be the <span className="text-bull">CEO</span> of a new
            AI-managed trading firm. Add other people from the Members page once
            you&apos;re in.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Full name">
              <input
                type="text"
                required
                minLength={1}
                maxLength={120}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Gregory Shoniwa"
                className={inputCls}
                autoComplete="name"
                autoFocus
              />
            </Field>

            <Field label="Work email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@firm.com"
                className={inputCls}
              />
            </Field>

            <Field
              label="Password"
              right={
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="normal-case tracking-normal text-text-mute hover:text-text"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              }
            >
              <input
                type={showPw ? "text" : "password"}
                required
                minLength={10}
                maxLength={200}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="••••••••••"
                className={inputCls}
              />
              <span className="mt-1 block text-[10px] text-text-mute">
                10+ chars · mixed case · a digit
              </span>
            </Field>

            <Field label="Company name (optional)">
              <input
                type="text"
                maxLength={80}
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Tendai Capital"
                className={inputCls}
              />
              <span className="mt-1 block text-[10px] text-text-mute">
                Skip to create one later.
              </span>
            </Field>

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
              {submitting ? "Creating…" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-text-mute">
            Already have an account?{" "}
            <Link href="/login" className="text-accent hover:opacity-80">
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <footer className="border-t border-border px-6 py-4 text-center text-[11px] text-text-mute">
        © {new Date().getFullYear()} TradeMaster · AI-orchestrated multi-model trading on Deriv
      </footer>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2.5 text-sm outline-none focus:border-accent";

function Field({
  label, right, children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-[11px] uppercase tracking-widest text-text-mute">
        {label}
        {right}
      </span>
      {children}
    </label>
  );
}
