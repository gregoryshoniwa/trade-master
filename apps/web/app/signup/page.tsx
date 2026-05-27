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
    <main className="mx-auto max-w-md px-6 py-12">
      <div className="rounded-2xl border border-border bg-bg-card p-8">
        <h1 className="mb-1 text-2xl font-semibold">Create your firm</h1>
        <p className="mb-6 text-sm text-text-mute">
          You'll be the <span className="text-bull">CEO</span> of a new
          AI-managed trading firm. Add other people from the Members page once
          you're in.
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
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
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
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
            />
          </Field>

          <Field label="Password">
            <input
              type="password"
              required
              minLength={10}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
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
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
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
            className="w-full rounded-md bg-bull py-2.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-mute">
          Already have an account?{" "}
          <Link href="/login" className="text-bull hover:opacity-80">
            Sign in
          </Link>
        </p>
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
