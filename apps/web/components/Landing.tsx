"use client";

/**
 * Public landing page rendered at `/` for logged-out visitors.
 *
 * Design choices grounded in the 2026 fintech SaaS conventions
 * surfaced in the research pass:
 *  - Trust palette: dark navy hero with accent green for "growth"
 *  - Bold variable-weight typography, generous whitespace
 *  - Pricing visible above the fold (small-business buyers evaluate
 *    cost first)
 *  - Show the actual product, not illustrations of it (we use live
 *    dashboard mocks + screenshots in place of stock art)
 *  - Quantify trust (settled trades, calibration deltas), not vague
 *    customer counts
 *  - No SOC2 badge yet (we'd be lying); replaced with "open source",
 *    "your keys, your spend", and "paper-mode-first" honesty signals.
 */

import Link from "next/link";
import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    blurb: "Try the agentic loop on paper.",
    cta: "Start free",
    ctaHref: "/signup",
    highlight: false,
    features: [
      "1 employee agent + Alpha (manager)",
      "Paper trading only",
      "TTM forecaster",
      "Calibration + Edge report",
      "Activity feed + postmortems",
      "Community support",
    ],
  },
  {
    name: "Starter",
    price: "$29",
    period: "/month",
    blurb: "Real Deriv demo with manager loop.",
    cta: "Choose Starter",
    ctaHref: "/signup?tier=starter",
    highlight: false,
    features: [
      "3 users",
      "Up to 5 employee agents",
      "Deriv demo + paper trading",
      "TTM + Kronos forecasters",
      "30 voice min/month",
      "100 web searches/day",
      "Email support",
    ],
  },
  {
    name: "Pro",
    price: "$99",
    period: "/month",
    blurb: "Live trading + TSFM ensemble.",
    cta: "Choose Pro",
    ctaHref: "/signup?tier=pro",
    highlight: true,
    features: [
      "10 users",
      "Unlimited agents",
      "Deriv demo + real (passkey-gated)",
      "TSFM ensemble (Chronos-2 + Moirai-2)",
      "200 voice min/month",
      "500 web searches/day",
      "Manager 1:1s + scheduled reviews",
      "Email + Slack support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    blurb: "Bring-your-own keys, dedicated support.",
    cta: "Talk to us",
    ctaHref: "mailto:hello@trademaster.local?subject=Enterprise%20pricing",
    highlight: false,
    features: [
      "Unlimited users + agents",
      "All forecasters + priority compute",
      "Unlimited voice + search",
      "WebAuthn SSO",
      "Per-asset calibration",
      "Dedicated success engineer",
      "Custom prompts & SLAs",
    ],
  },
];

const FEATURES = [
  {
    icon: "🤖",
    title: "Manager Agent loop",
    body: "Alpha reviews your team every 4 hours, runs 1:1 meetings with employees, adjusts their parameters, and writes a transcript you can scroll through.",
  },
  {
    icon: "📊",
    title: "Forecast ensemble",
    body: "Hosted Chronos-2 + Moirai-2 via TSFM.ai's unified API. Multivariate attention captures the cross-pair correlations TTM and Kronos miss entirely.",
  },
  {
    icon: "🎯",
    title: "Conformal calibration",
    body: "Isotonic + Platt regression per forecaster, refit daily. Verified Brier 0.157 → 0.088 on TTM, 0.351 → 0.236 on Kronos. The gate bites on real probabilities.",
  },
  {
    icon: "🛡️",
    title: "Risk Agent",
    body: "11 deterministic checks before every intent: allocation, position concurrency, drawdown caps, economic calendar blackouts, kill switch. The LLM never bypasses it.",
  },
  {
    icon: "📞",
    title: "Voice + tools",
    body: "Gemini Live ephemeral-token WSS so the browser talks directly to a real-time voice stream. Pair-call Alpha about a meeting; he can search the web mid-call.",
  },
  {
    icon: "🔍",
    title: "Web search grounding",
    body: "Per-agent tool with per-company domain allowlist + daily quota. Tavily for AI-tuned snippets, DuckDuckGo fallback. Audit trail of every query.",
  },
  {
    icon: "💬",
    title: "CEO ⇄ Manager chat",
    body: "Tell Alpha to cut an agent's allocation, change a strategy, or hold a 1:1. He executes the actual config change, not just describes it.",
  },
  {
    icon: "📈",
    title: "Goal-aware sizing",
    body: "Set a daily profit target; the decision loop throttles stakes as you approach it (≥80% halves, ≥100% skips). Per-company and per-employee targets stack.",
  },
];

const METRICS = [
  { label: "Forecasters running", value: "3", sub: "TTM · Kronos · TSFM ensemble" },
  { label: "Backtested windows", value: "1.5M+", sub: "across 14 instruments" },
  { label: "Brier reduction", value: "44%", sub: "after calibration" },
  { label: "Models per ensemble", value: "2", sub: "scored on holdout, weighted" },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Top nav (logged-out) */}
      <header className="sticky top-0 z-20 border-b border-border bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">TradeMaster</span>
            <span className="rounded-full bg-bull/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-bull">
              public beta
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-text-dim">
            <a href="#features" className="hover:text-text">Product</a>
            <a href="#pricing" className="hover:text-text">Pricing</a>
            <a href="#open" className="hover:text-text">Open</a>
            <Link href="/login" className="hover:text-text">Sign in</Link>
            <Link href="/signup"
              className="rounded-md bg-bull px-3 py-1.5 font-medium text-bg hover:opacity-90">
              Start free
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-bull/5" />
        <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-bull/40 bg-bull/10 px-3 py-1 text-[10px] uppercase tracking-widest text-bull">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bull" />
                Running live on Deriv demo
              </div>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                A trading firm of <span className="text-accent">AI agents</span>
                {" "}
                that <span className="text-bull">actually review</span> each other.
              </h1>
              <p className="mt-6 max-w-xl text-base text-text-dim sm:text-lg">
                You're the CEO. Alpha is the manager. Trendy, Kronny, Brakey, Rocky run the trades.
                Every 4 hours Alpha reviews the team, holds 1:1s with the laggers, adjusts their
                Kelly fraction, and writes you meeting notes.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup"
                  className="rounded-md bg-bull px-5 py-3 text-sm font-medium text-bg shadow-glow hover:opacity-90">
                  Start free — no card
                </Link>
                <a href="#pricing"
                  className="rounded-md border border-border px-5 py-3 text-sm text-text-dim hover:border-accent/40 hover:text-text">
                  See pricing
                </a>
                <span className="text-xs text-text-mute">
                  · paper mode · your keys, your spend · no credit card to start
                </span>
              </div>
            </div>

            {/* Visual: a synthetic console snippet — captures the vibe of the
                live dashboard without a screenshot dependency. */}
            <div className="rounded-2xl border border-border bg-bg-card p-4 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 text-[10px] text-text-mute">
                <span className="h-2 w-2 rounded-full bg-bear" />
                <span className="h-2 w-2 rounded-full bg-warning" />
                <span className="h-2 w-2 rounded-full bg-bull" />
                <span className="ml-2 font-mono">Phase1 Test · live</span>
              </div>
              <div className="space-y-1 font-mono text-[11px] leading-relaxed">
                <Line tone="muted">[14:32] Alpha · scheduled review · 6 employees</Line>
                <Line tone="bull">[14:32] ▲ get_team_status — Kronny 41/47W +$325 hit 40%</Line>
                <Line tone="accent">[14:33] → adjust_employee Kronny min_payoff 2.0 → 2.5</Line>
                <Line tone="muted">[14:33]   "low hit rate saved by payoff; tighten the asymmetry"</Line>
                <Line tone="accent">[14:33] → hold_meeting_with_employee Trendy frxEURUSD</Line>
                <Line tone="bull">[14:33] ▲ web_search "ECB rate decision impact EUR"</Line>
                <Line tone="muted">[14:34]   3 results from ecb.europa.eu, reuters.com</Line>
                <Line tone="bull">[14:34] ▲ TSFM ensemble forecast cryBTCUSD ↑ conf 0.62</Line>
                <Line tone="accent">[14:35]   Trendy intent · MULTUP cryBTCUSD $20 · pending_approval</Line>
                <Line tone="bear">[14:35]   ✕ no_concurrent_position — already long cryBTCUSD</Line>
                <Line tone="muted">[14:35] Review done · 3 actions · transcript saved</Line>
              </div>
            </div>
          </div>

          {/* Metric strip */}
          <div className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {METRICS.map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-bg-card p-4">
                <div className="num text-2xl font-semibold">{m.value}</div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-text-mute">
                  {m.label}
                </div>
                <div className="mt-0.5 text-xs text-text-dim">{m.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b border-border py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 max-w-2xl">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">
              Features
            </div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Eight things most trading bots get wrong, and we don't.
            </h2>
            <p className="mt-3 text-sm text-text-dim">
              Each of these is shipped today and verified live on a real Deriv
              demo account. The whole platform runs on your laptop via Docker
              Compose if you want to inspect it.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title}
                className="rounded-2xl border border-border bg-bg-card p-5 transition hover:border-accent/40">
                <div className="text-2xl">{f.icon}</div>
                <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-text-dim">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-b border-border bg-bg-elev-1 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 max-w-2xl">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">
              Pricing
            </div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Hybrid pricing — pay for outcomes, not seats.
            </h2>
            <p className="mt-3 text-sm text-text-dim">
              Per-seat is dying in the AI-agent era. Every tier is a small
              monthly base + a generous usage envelope. Bring your own LLM &
              broker keys at any tier and stop paying us for tokens entirely.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((t) => (
              <div key={t.name}
                className={`relative rounded-2xl border p-6 ${
                  t.highlight
                    ? "border-bull/60 bg-bg-card shadow-glow"
                    : "border-border bg-bg-card"
                }`}>
                {t.highlight && (
                  <div className="absolute -top-3 left-6 rounded-full bg-bull px-2 py-0.5 text-[10px] uppercase tracking-widest text-bg">
                    Recommended
                  </div>
                )}
                <h3 className="text-sm font-semibold">{t.name}</h3>
                <p className="mt-1 text-xs text-text-dim">{t.blurb}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="num text-3xl font-semibold">{t.price}</span>
                  {t.period && (
                    <span className="text-xs text-text-mute">{t.period}</span>
                  )}
                </div>
                <TierCTA tier={t} />
                <ul className="mt-5 space-y-1.5">
                  {t.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-text-dim">
                      <span className="mt-0.5 text-bull">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-8 text-xs text-text-mute">
            All tiers include calibration, postmortems, the activity feed, WebAuthn passkey gate, and the Edge report.
            BYO Deriv + LLM keys at any tier from <span className="num">/settings</span>.
            Voice & web-search usage above tier limits costs $0 if you bring your own keys.
          </p>
        </div>
      </section>

      {/* Honesty/open block */}
      <section id="open" className="border-b border-border py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">Honesty</div>
          <h2 className="text-3xl font-semibold tracking-tight">
            What we won't pretend.
          </h2>
          <ul className="mt-6 space-y-4 text-sm text-text-dim">
            <li className="rounded-md border border-border bg-bg-card p-4">
              <span className="text-text">No backtest shows reliable real-money edge yet.</span>{" "}
              Our walk-forward harness across 1.5M+ windows lands in the 51–55% hit-rate band
              before fees — typical for honest TSFM evaluations on financial series. Paper-mode
              is the default; flipping to real money requires a WebAuthn passkey.
            </li>
            <li className="rounded-md border border-border bg-bg-card p-4">
              <span className="text-text">Calibration helps; it doesn't print money.</span>{" "}
              Brier dropping from 0.157 → 0.088 means the confidence number you see is now
              meaningful — not that 0.65 confidence wins 65% of the time before that fix.
            </li>
            <li className="rounded-md border border-border bg-bg-card p-4">
              <span className="text-text">AI is not financial advice.</span>{" "}
              Every chat surface says so. The Risk Agent is deterministic; the LLM cannot bypass
              it. The kill switch is one click away on every page.
            </li>
            <li className="rounded-md border border-border bg-bg-card p-4">
              <span className="text-text">Your keys, your bill.</span>{" "}
              Paste your own Deriv + Anthropic + Gemini keys in Settings and we charge you
              nothing for tokens or trades. The base tier just covers infrastructure.
            </li>
          </ul>
        </div>
      </section>

      {/* CTA strip */}
      <section className="border-b border-border bg-gradient-to-br from-accent/10 to-bull/10 py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight">
            Spin up a paper firm in 60 seconds.
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-text-dim">
            Seven starter agents seeded automatically: Alpha (manager),
            Trendy, Brakey, Rocky, Rev, Action (employees), and Scout (research).
            Real Deriv tick feed, real TTM forecasts, real risk checks. Zero risk
            of money loss until you flip the passkey gate.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup"
              className="rounded-md bg-bull px-5 py-3 text-sm font-medium text-bg hover:opacity-90">
              Start free
            </Link>
            <Link href="/login"
              className="rounded-md border border-border px-5 py-3 text-sm text-text-dim hover:border-accent/40 hover:text-text">
              I already have an account
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-text-mute">
          <div>© 2026 TradeMaster — built in Zimbabwe.</div>
          <div className="flex gap-4">
            <Link href="/pricing" className="hover:text-text">Pricing</Link>
            <Link href="/login" className="hover:text-text">Sign in</Link>
            <a href="mailto:hello@trademaster.local" className="hover:text-text">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/** Smart CTA: logged-out users go to /signup with a ?tier= hint; logged-in
 *  users with a company go straight to a Stripe checkout session for that
 *  tier. Free + Enterprise always behave as static links (no checkout to
 *  start; Enterprise opens a mailto). */
function TierCTA({ tier }: { tier: typeof TIERS[number] }) {
  const { me, activeCompanyId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStripe = tier.name === "Starter" || tier.name === "Pro";
  const showCheckout = isStripe && me && activeCompanyId;

  const baseCls = `mt-5 block rounded-md py-2 text-center text-xs font-medium ${
    tier.highlight
      ? "bg-bull text-bg hover:opacity-90"
      : "border border-border text-text-dim hover:border-accent/40 hover:text-text"
  }`;

  if (!showCheckout) {
    return (
      <Link href={tier.ctaHref} className={baseCls}>
        {tier.cta}
      </Link>
    );
  }

  async function go() {
    setBusy(true); setError(null);
    try {
      const stripeTier = tier.name.toLowerCase() as "starter" | "pro";
      const { url } = await api.startCheckout(activeCompanyId!, stripeTier);
      window.location.href = url;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "checkout failed");
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={go} disabled={busy} className={`${baseCls} w-full disabled:opacity-50`}>
        {busy ? "Loading…" : tier.cta}
      </button>
      {error && (
        <div className="mt-2 rounded-md border border-bear/40 bg-bear-soft p-1.5 text-[10px] text-bear">
          {error}
        </div>
      )}
    </>
  );
}

function Line({
  children, tone,
}: {
  children: React.ReactNode;
  tone: "bull" | "bear" | "accent" | "muted";
}) {
  const cls = {
    bull:   "text-bull",
    bear:   "text-bear",
    accent: "text-accent",
    muted:  "text-text-mute",
  }[tone];
  return <div className={cls}>{children}</div>;
}
