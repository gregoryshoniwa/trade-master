"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, ApiError, type WebSearchConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [cfg, setCfg] = useState<WebSearchConfig | null>(null);
  const [allowedText, setAllowedText] = useState("");
  const [blockedText, setBlockedText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [quota, setQuota] = useState(25);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeCompanyId) return;
    api.getWebSearchConfig(activeCompanyId).then((c) => {
      setCfg(c);
      setEnabled(c.enabled);
      setAllowedText(c.allowed_domains.join("\n"));
      setBlockedText(c.blocked_domains.join("\n"));
      setQuota(c.daily_quota);
      setDirty(false);
    }).catch((e) => setError(e instanceof ApiError ? e.message : "load failed"));
  }, [activeCompanyId]);

  async function save() {
    if (!activeCompanyId) return;
    setBusy(true); setError(null);
    try {
      const allowed = allowedText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const blocked = blockedText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const updated = await api.updateWebSearchConfig(activeCompanyId, {
        enabled, allowed_domains: allowed, blocked_domains: blocked, daily_quota: quota,
      });
      setCfg(updated);
      setAllowedText(updated.allowed_domains.join("\n"));
      setBlockedText(updated.blocked_domains.join("\n"));
      setDirty(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  function mark<T>(s: (v: T) => void) {
    return (v: T) => { s(v); setDirty(true); };
  }

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <Link href="/login" className="text-bull">Sign in</Link>
      </main>
    );
  }
  if (!active) {
    return <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">Select or create a company first.</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{active.name} — Settings</h1>
        <p className="text-xs text-text-mute">
          AI tool configuration. Bind agents tightly enough that they don't waste budget; loosely enough that they can actually help.
        </p>
      </header>

      {error && <div className="rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      <section className="rounded-2xl border border-border bg-bg-card p-5 space-y-4">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Internet search tool</h2>
            <p className="mt-1 text-xs text-text-mute">
              When enabled, agents can call <span className="num">web_search</span> to ground answers in fresh information. The domain allowlist (if non-empty) is the only set of sources they're allowed to read from.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => mark(setEnabled)(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            <span>{enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Allowed domains"
            hint={"One per line. Empty = any non-blocked domain. Subdomain matches, so 'reuters.com' covers 'finance.reuters.com'."}
          >
            <textarea
              value={allowedText}
              onChange={(e) => mark(setAllowedText)(e.target.value)}
              rows={6}
              placeholder={"reuters.com\nft.com\nwsj.com"}
              className={textareaCls}
              disabled={!enabled}
            />
          </Field>
          <Field
            label="Blocked domains"
            hint="Hard deny. Wins over the allowlist."
          >
            <textarea
              value={blockedText}
              onChange={(e) => mark(setBlockedText)(e.target.value)}
              rows={6}
              placeholder={"reddit.com\nx.com"}
              className={textareaCls}
              disabled={!enabled}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Daily quota"
            hint="Maximum successful searches per day across all agents in this company."
          >
            <input
              type="number"
              min={0}
              max={10000}
              value={quota}
              onChange={(e) => mark(setQuota)(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))}
              className={inputCls}
              disabled={!enabled}
            />
          </Field>
          <div>
            <div className="text-xs uppercase tracking-widest text-text-mute">Used today</div>
            <div className="mt-1 num text-2xl">
              {cfg?.used_today ?? 0} <span className="text-sm text-text-mute">/ {cfg?.daily_quota ?? quota}</span>
            </div>
          </div>
        </div>

        {dirty && (
          <div className="sticky bottom-4 flex items-center justify-between rounded-xl border border-bull/40 bg-bull-soft p-3">
            <span className="text-sm">Unsaved changes</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-sm text-text-mute hover:text-text"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50";
const textareaCls =
  "w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm font-mono outline-none focus:border-accent disabled:opacity-50";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs uppercase tracking-widest text-text-mute">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-text-mute">{hint}</span>}
    </label>
  );
}
