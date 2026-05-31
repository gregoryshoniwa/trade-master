"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  api, ApiError,
  type BillingStatus, type CompanyGoals, type CredentialsStatus,
  type TierStatus, type WebSearchConfig,
} from "@/lib/api";
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
      <TierSection companyId={activeCompanyId} />
      <BillingSection companyId={activeCompanyId} />
      <CompanyGoalsSection companyId={activeCompanyId} />
      <DerivSection companyId={activeCompanyId} />
      <AIProvidersSection companyId={activeCompanyId} />
      <WebSearchSection companyId={activeCompanyId} />
    </main>
  );
}

function DerivSection({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<CredentialsStatus | null>(null);
  const [demo, setDemo] = useState("");
  const [real, setReal] = useState("");
  const [env, setEnv] = useState<"demo" | "real">("demo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getCredentials(companyId);
      setStatus(s);
      setEnv(s.deriv_environment);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true); setError(null); setDone(null);
    try {
      const body: Record<string, string> = { deriv_environment: env };
      if (demo) body.deriv_token_demo = demo;
      if (real) body.deriv_token_real = real;
      const next = await api.updateCredentials(companyId, body);
      setStatus(next); setEnv(next.deriv_environment);
      setDemo(""); setReal("");
      setDone("Saved");
      setTimeout(() => setDone(null), 4000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearKey(kind: "demo" | "real") {
    if (!confirm(`Clear the ${kind} Deriv token?`)) return;
    setBusy(true); setError(null);
    try {
      const next = await api.updateCredentials(companyId, {
        [kind === "demo" ? "deriv_token_demo" : "deriv_token_real"]: "",
      });
      setStatus(next);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "clear failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium">Deriv integration</h2>
        <p className="mt-1 text-xs text-text-mute">
          Connect your own Deriv account. Demo tokens come from{" "}
          <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">app.deriv.com/account/api-token</a>{" "}
          (create with at least Read + Trade scopes). Real tokens enable
          live money — paper mode + WebAuthn passkey gate still apply.
        </p>
      </header>

      <div className="flex items-baseline gap-3 text-sm">
        <span className="text-text-mute">Active environment:</span>
        <div className="flex gap-1 rounded-md border border-border bg-bg-elev-1 p-1 text-xs">
          {(["demo", "real"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => setEnv(opt)}
              className={`rounded px-3 py-1 ${env === opt ? (opt === "real" ? "bg-bear text-white" : "bg-accent text-white") : "text-text-mute hover:text-text"}`}
            >
              {opt === "demo" ? "Demo" : "Real"}
            </button>
          ))}
        </div>
        {env === "real" && (
          <span className="text-xs text-bear">⚠ Real money</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Demo token"
          hint={status?.deriv_demo_configured ? "Configured. Paste a new one to replace." : "Not configured."}
        >
          <div className="flex gap-2">
            <input
              type="password"
              value={demo}
              onChange={(e) => setDemo(e.target.value)}
              placeholder={status?.deriv_demo_configured ? "•••••••• (paste to replace)" : "paste demo token"}
              className={inputCls}
            />
            {status?.deriv_demo_configured && (
              <button type="button" onClick={() => clearKey("demo")}
                className="text-xs text-bear hover:underline disabled:opacity-50" disabled={busy}>
                Clear
              </button>
            )}
          </div>
        </Field>
        <Field
          label="Real token"
          hint={status?.deriv_real_configured ? "Configured. Paste a new one to replace." : "Not configured (paper-mode is fine without one)."}
        >
          <div className="flex gap-2">
            <input
              type="password"
              value={real}
              onChange={(e) => setReal(e.target.value)}
              placeholder={status?.deriv_real_configured ? "•••••••• (paste to replace)" : "paste real token"}
              className={inputCls}
            />
            {status?.deriv_real_configured && (
              <button type="button" onClick={() => clearKey("real")}
                className="text-xs text-bear hover:underline disabled:opacity-50" disabled={busy}>
                Clear
              </button>
            )}
          </div>
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-bear">{error}</span>}
        {done && <span className="text-xs text-bull">{done}</span>}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

function AIProvidersSection({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<CredentialsStatus | null>(null);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setStatus(await api.getCredentials(companyId)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "load failed"); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const PROVIDERS = [
    { key: "anthropic_api_key", flag: "anthropic_configured", label: "Anthropic (Claude)", link: "https://console.anthropic.com/settings/keys" },
    { key: "gemini_api_key",    flag: "gemini_configured",    label: "Google Gemini (text + voice)", link: "https://aistudio.google.com/app/apikey" },
    { key: "openai_api_key",    flag: "openai_configured",    label: "OpenAI", link: "https://platform.openai.com/api-keys" },
    { key: "openrouter_api_key", flag: "openrouter_configured", label: "OpenRouter (DeepSeek / Llama / etc.)", link: "https://openrouter.ai/keys" },
    { key: "groq_api_key",      flag: "groq_configured",      label: "Groq", link: "https://console.groq.com/keys" },
  ] as const;

  async function save() {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(keys)) {
      if (v.trim()) payload[k] = v.trim();
    }
    if (Object.keys(payload).length === 0) {
      setError("nothing to save"); return;
    }
    setBusy(true); setError(null); setDone(null);
    try {
      const next = await api.updateCredentials(companyId, payload);
      setStatus(next);
      setKeys({});
      setDone("Saved");
      setTimeout(() => setDone(null), 4000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearProvider(field: string) {
    if (!confirm(`Clear this key?`)) return;
    setBusy(true); setError(null);
    try {
      setStatus(await api.updateCredentials(companyId, { [field]: "" }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "clear failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium">AI provider keys</h2>
        <p className="mt-1 text-xs text-text-mute">
          Bring-your-own keys. When set, your agents bill against your own
          quotas instead of the platform's. Leave blank and we'll use the
          platform's keys (subject to your tier's usage limits).
        </p>
      </header>
      <ul className="space-y-3">
        {PROVIDERS.map((p) => {
          const configured = !!(status as unknown as Record<string, boolean>)?.[p.flag];
          return (
            <li key={p.key} className="grid items-baseline gap-2 sm:grid-cols-[12rem_1fr_auto]">
              <div>
                <div className="text-xs font-medium">{p.label}</div>
                <a href={p.link} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-accent hover:underline">
                  Get key →
                </a>
              </div>
              <input
                type="password"
                value={keys[p.key] ?? ""}
                onChange={(e) => setKeys({ ...keys, [p.key]: e.target.value })}
                placeholder={configured ? "•••••••• (paste to replace)" : "paste key"}
                className={inputCls}
              />
              <div className="flex items-center gap-2 text-xs">
                {configured ? (
                  <>
                    <span className="text-bull">✓ Set</span>
                    <button type="button" onClick={() => clearProvider(p.key)}
                      className="text-bear hover:underline disabled:opacity-50" disabled={busy}>
                      Clear
                    </button>
                  </>
                ) : (
                  <span className="text-text-mute">Not set</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-bear">{error}</span>}
        {done && <span className="text-xs text-bull">{done}</span>}
        <button
          type="button"
          onClick={save}
          disabled={busy || Object.values(keys).every((v) => !v.trim())}
          className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
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

function BillingSection({ companyId }: { companyId: string }) {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [busy, setBusy] = useState<"starter" | "pro" | "portal" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getBillingStatus(companyId).then(setStatus)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "load failed"));
  }, [companyId]);

  // Show a one-shot banner if the user just came back from a checkout.
  const [banner, setBanner] = useState<"success" | "cancel" | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const v = params.get("billing");
    if (v === "success" || v === "cancel") {
      setBanner(v);
      // Strip the param so a refresh doesn't show it again.
      params.delete("billing");
      const q = params.toString();
      window.history.replaceState({}, "",
        window.location.pathname + (q ? `?${q}` : ""));
    }
  }, []);

  async function checkout(tier: "starter" | "pro") {
    setBusy(tier); setErr(null);
    try {
      const { url } = await api.startCheckout(companyId, tier);
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "checkout failed");
      setBusy(null);
    }
  }

  async function portal() {
    setBusy("portal"); setErr(null);
    try {
      const { url } = await api.openBillingPortal(companyId);
      window.location.href = url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "portal open failed");
      setBusy(null);
    }
  }

  if (status && !status.enabled) {
    // Billing isn't configured on this api instance. Show a hint for
    // operators rather than a confusing empty card.
    return (
      <section className="rounded-2xl border border-border bg-bg-card p-5 text-xs text-text-mute">
        Billing isn't configured on this instance.{" "}
        <span className="num">STRIPE_SECRET_KEY</span> is unset on the api —
        the operator runs the platform under self-hosted control.
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5 space-y-4">
      <header>
        <h2 className="text-sm font-medium">Billing</h2>
        <p className="mt-1 text-xs text-text-mute">
          Manage your subscription via Stripe. Cancellation, invoice history,
          and payment-method updates happen in the customer portal.
        </p>
      </header>

      {banner === "success" && (
        <div className="rounded-md border border-bull/40 bg-bull-soft p-3 text-xs text-bull">
          ✓ Checkout completed. Your tier will update within a few seconds
          when Stripe confirms the subscription.
        </div>
      )}
      {banner === "cancel" && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          Checkout cancelled. No charge has been made.
        </div>
      )}

      <div className="grid gap-2 text-xs">
        <FeatureRow label="Customer ID">
          {status?.has_customer ? (
            <span className="text-bull">✓ linked</span>
          ) : (
            <span className="text-text-mute">not yet — start a checkout to create one</span>
          )}
        </FeatureRow>
        <FeatureRow label="Subscription status">
          <span className={
            status?.subscription_status === "active" ? "text-bull"
            : status?.subscription_status == null ? "text-text-mute"
            : "text-warning"
          }>
            {status?.subscription_status ?? "no active subscription"}
          </span>
        </FeatureRow>
        {status?.current_period_end && (
          <FeatureRow label="Renews / ends">
            <span className="num">{new Date(status.current_period_end).toLocaleDateString()}</span>
          </FeatureRow>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {err && <span className="text-xs text-bear">{err}</span>}
        {status?.portal_available && (
          <button
            type="button"
            onClick={portal}
            disabled={busy !== null}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:border-accent/40 disabled:opacity-40"
          >
            {busy === "portal" ? "Opening…" : "Manage subscription →"}
          </button>
        )}
        <button
          type="button"
          onClick={() => checkout("starter")}
          disabled={busy !== null}
          className="rounded-md border border-accent/40 px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {busy === "starter" ? "Loading…" : "Upgrade to Starter"}
        </button>
        <button
          type="button"
          onClick={() => checkout("pro")}
          disabled={busy !== null}
          className="rounded-md bg-bull px-3 py-1.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {busy === "pro" ? "Loading…" : "Upgrade to Pro"}
        </button>
      </div>
    </section>
  );
}

function TierSection({ companyId }: { companyId: string }) {
  const [tier, setTier] = useState<TierStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.getTierStatus(companyId).then(setTier)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "load failed"));
  }, [companyId]);

  if (err) return <div className="text-xs text-text-mute">Tier: {err}</div>;
  if (!tier) return null;

  const isFree = tier.tier_name === "free";
  const limits = tier.limits;
  const usage = tier.usage;
  const userPct = limits.max_users != null && limits.max_users > 0
    ? Math.min(100, (usage.users / limits.max_users) * 100) : 0;
  const empPct = limits.max_employees != null && limits.max_employees > 0
    ? Math.min(100, (usage.employee_agents / limits.max_employees) * 100) : 0;
  const webPct = limits.web_search_daily_quota != null && limits.web_search_daily_quota > 0
    ? Math.min(100, (usage.web_search_today / limits.web_search_daily_quota) * 100) : 0;

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-5 space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="text-sm font-medium">Subscription</h2>
          <span className={`rounded-full bg-bg-elev-2 px-3 py-1 text-[10px] uppercase tracking-widest ${tier.label_color}`}>
            {tier.label}
          </span>
        </div>
        <Link href="/pricing"
          className="text-xs text-accent hover:underline">
          {isFree ? "See plans →" : "Compare plans →"}
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <UsageTile
          label="Members"
          used={usage.users}
          cap={limits.max_users}
          pct={userPct}
        />
        <UsageTile
          label="Employee agents"
          used={usage.employee_agents}
          cap={limits.max_employees}
          pct={empPct}
        />
        <UsageTile
          label="Web searches today"
          used={usage.web_search_today}
          cap={limits.web_search_daily_quota}
          pct={webPct}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <FeatureRow label="Forecasters">
          {limits.allowed_forecasters.map((f) => (
            <span key={f} className="num mr-1 rounded bg-bg-elev-2 px-1.5 py-0.5 text-[10px] text-text-dim">
              {f}
            </span>
          ))}
        </FeatureRow>
        <FeatureRow label="Real-money trading">
          {limits.paper_only ? (
            <span className="text-text-mute">paper only</span>
          ) : (
            <span className="text-bull">✓ allowed (passkey gated)</span>
          )}
        </FeatureRow>
        <FeatureRow label="Voice chat">
          {limits.voice_minutes_per_month == null
            ? <span className="text-bull">unlimited</span>
            : limits.voice_minutes_per_month === 0
              ? <span className="text-text-mute">not included</span>
              : <span>{limits.voice_minutes_per_month} min / mo</span>}
        </FeatureRow>
        <FeatureRow label="Manager loop (1:1s, reviews)">
          {limits.manager_loop ? (
            <span className="text-bull">✓ included</span>
          ) : (
            <span className="text-text-mute">not included</span>
          )}
        </FeatureRow>
      </div>

      {isFree && (
        <div className="rounded-md border border-accent/30 bg-accent/5 p-3 text-xs text-text-dim">
          You're on the free tier. Upgrade to Starter to unlock Kronos, voice
          chat, and 100 daily web searches.{" "}
          <Link href="/pricing" className="text-accent hover:underline">See pricing →</Link>
        </div>
      )}
    </section>
  );
}

function UsageTile({
  label, used, cap, pct,
}: { label: string; used: number; cap: number | null; pct: number }) {
  const tone = pct >= 90 ? "bg-bear" : pct >= 70 ? "bg-warning" : "bg-bull";
  return (
    <div className="rounded-md bg-bg-elev-1 p-3">
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-text-mute">{label}</span>
        <span className="num text-text">
          {used}{cap != null ? ` / ${cap}` : ""}
        </span>
      </div>
      {cap != null && cap > 0 ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-bg-elev-2">
          <div className={`h-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      ) : (
        <div className="text-[10px] text-text-mute">unlimited</div>
      )}
    </div>
  );
}

function FeatureRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-bg-elev-1 px-3 py-2">
      <span className="text-text-mute">{label}</span>
      <span>{children}</span>
    </div>
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
