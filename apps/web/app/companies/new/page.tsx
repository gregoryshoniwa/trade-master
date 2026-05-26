"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const PRESET_COLORS = ["#A8FF35", "#00B8D4", "#FF6D5C", "#FBBF24", "#60A5FA", "#E91E63"];

export default function NewCompanyPage() {
  const router = useRouter();
  const { refresh, setActiveCompany } = useAuth();
  const [name, setName] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const c = await api.createCompany(name.trim(), color);
      setActiveCompany(c.id);
      await refresh();
      router.replace("/");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "create failed");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <div className="rounded-2xl border border-border bg-bg-card p-8">
        <h1 className="mb-1 text-2xl font-semibold">Create your trading firm</h1>
        <p className="mb-6 text-sm text-text-mute">
          You&apos;ll be the owner. Starts at <span className="text-bull">Tier 1</span>{" "}
          (Forex Majors). Unlock more by trading well.
        </p>

        <form onSubmit={onSubmit} className="space-y-5">
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-text-mute">
              Company name
            </span>
            <input
              type="text"
              required
              minLength={2}
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
              placeholder="Tendai Capital"
              autoFocus
            />
          </label>

          <div>
            <div className="text-xs uppercase tracking-widest text-text-mute">
              Brand color
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition ${
                    color === c ? "border-text scale-110" : "border-border"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

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
            {submitting ? "Creating…" : "Create company"}
          </button>
        </form>
      </div>
    </main>
  );
}
