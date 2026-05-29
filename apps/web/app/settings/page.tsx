"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, ApiError, type CompanyGoals, type WebSearchConfig } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function SettingsPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <Link href="/login" className="text-bull">Sign in</Link>
      </main>
    );
  }
  if (!active || !activeCompanyId) {
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
      <CompanyGoalsSection companyId={activeCompanyId} />
      <WebSearchSection companyId={activeCompanyId} />
    </main>
  );
}

function CompanyGoalsSection({ companyId }: { companyId: string }) {
  const [goals, setGoals] = useState<CompanyGoals | null>(null);
  const [target, setTarget] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getCompanyGoals(companyId).then((g) => {
      setGoals(g);
      setTarget(g.daily_profit_target_usd != null ? String(g.daily_profit_target_usd) : "");
    }).catch((e) => setError(e instanceof ApiError ? e.message : "load failed"));
  }, [companyId]);

  async function save() {
    setBusy(true); setError(null);
    try {
      const trimmed = target.trim();
      const value = trimmed === "" ? null : Math.max(0, Math.min(100000, Number(trimmed) || 0));
      const next = await api.updateCompanyGoals(companyId, { daily_profit_target_usd: value });
      setGoals(next);
      setTarget(next.daily_profit_target_usd != null ? String(next.daily_profit_target_usd) : "");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  const dirty = (goals?.daily_profit_target_usd != null ? String(goals.daily_profit_target_usd) : "") !== target;

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5 space-y-3">
      <header>
        <h2 className="text-sm font-medium">Daily profit target</h2>
        <p className="mt-1 text-xs text-text-mute">
          The CEO's target in USD. The manager reads this at every review and uses it when sizing positions and judging employees. Leave blank for "no specific target — just don't lose money".
        </p>
      </header>
      <div className="flex items-baseline gap-3">
        <span className="text-sm text-text-mute">$</span>
        <input
          type="number"
          min={0}
          max={100000}
          step={1}
          placeholder="e.g. 25"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="w-32 rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <span className="text-xs text-text-mute">per day</span>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="ml-auto rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <div className="text-xs text-bear">{error}</div>}
    </section>
  );
}

function WebSearchSection({ companyId }: { companyId: string }) {
  const [cfg, setCfg] = useState<WebSearchConfig | null>(null);
  const [allowedText, setAllowedText] = useState("");
  const [blockedText, setBlockedText] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [quota, setQuota] = useState(25);
  const [backend, setBackend] = useState<"auto" | "tavily" | "duckduckgo">("auto");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getWebSearchConfig(companyId).then((c) => {
      setCfg(c);
      setEnabled(c.enabled);
      setAllowedText(c.allowed_domains.join("\n"));
      setBlockedText(c.blocked_domains.join("\n"));
      setQuota(c.daily_quota);
      setBackend(c.backend);
      setDirty(false);
    }).catch((e) => setError(e instanceof ApiError ? e.message : "load failed"));
  }, [companyId]);

  async function save() {
    setBusy(true); setError(null);
    try {
      const allowed = allowedText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const blocked = blockedText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const updated = await api.updateWebSearchConfig(companyId, {
        enabled, allowed_domains: allowed, blocked_domains: blocked,
        daily_quota: quota, backend,
      });
      setCfg(updated);
      setAllowedText(updated.allowed_domains.join("\n"));
      setBlockedText(updated.blocked_domains.join("\n"));
      setBackend(updated.backend);
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

  return (
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

      <Field
        label="Search backend"
        hint={
          cfg?.tavily_available
            ? "Tavily returns cleaner, AI-tuned snippets. Auto prefers Tavily and falls back to DuckDuckGo on error."
            : "TAVILY_API_KEY is NOT set on the api server — Tavily option will fail until it's configured. Auto falls through to DuckDuckGo."
        }
      >
        <div className="flex flex-wrap gap-2">
          {(["auto", "tavily", "duckduckgo"] as const).map((b) => {
            const labels: Record<typeof b, string> = {
              auto: "Auto (Tavily → DDG)",
              tavily: "Tavily only",
              duckduckgo: "DuckDuckGo only",
            };
            return (
              <button
                key={b}
                type="button"
                onClick={() => mark(setBackend)(b)}
                disabled={!enabled}
                className={`rounded-md border px-3 py-1.5 text-xs transition ${
                  backend === b
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-bg-elev-1 text-text-dim hover:border-accent/40"
                } disabled:opacity-50`}
              >
                {labels[b]}
                {b === "tavily" && !cfg?.tavily_available && (
                  <span className="ml-1 text-[9px] text-bear">no key</span>
                )}
              </button>
            );
          })}
        </div>
      </Field>

      {error && <div className="text-xs text-bear">{error}</div>}

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
