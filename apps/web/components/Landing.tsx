"use client";

/**
 * Public landing page for logged-out visitors.
 *
 * Positioning: "the first trading platform where AI agents hold real
 * meetings about your account." We do not name specific LLM or
 * forecaster providers anywhere on this page — the product is the
 * agentic loop, not the model that powers it.
 *
 * Motion + visuals: hand-rolled CSS/SVG only — animated lens flares,
 * a wireframe globe with trading-hub nodes, and an SVG candlestick
 * mock-chart. No framer-motion / three.js / lottie bundles.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
      "Lightweight forecaster",
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
      "Two forecaster families",
      "30 voice min/month",
      "100 web searches/day",
      "Email support",
    ],
  },
  {
    name: "Pro",
    price: "$99",
    period: "/month",
    blurb: "Live trading + multi-model ensemble.",
    cta: "Choose Pro",
    ctaHref: "/signup?tier=pro",
    highlight: true,
    features: [
      "10 users",
      "Unlimited agents",
      "Deriv demo + real (passkey-gated)",
      "Multi-model forecaster ensemble",
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
    accent: "accent",
    title: "AI 1:1 meetings",
    body: "Alpha sits down with each agent every 4 hours, reads the postmortems, and rewrites their strategy. You scroll the transcript like a Notion doc.",
  },
  {
    accent: "bull",
    title: "Auto-executing manager",
    body: "When Alpha decides Kronny's risk/reward target should move from 2.0 to 2.5, he updates the row. No human in the loop, audit trail on every change.",
  },
  {
    accent: "accent",
    title: "Multi-model forecasts",
    body: "Three independent forecasters score every tick. Each agent picks one; the Risk Agent demands they agree past your threshold before any contract opens.",
  },
  {
    accent: "warning",
    title: "Conformal calibration",
    body: "Isotonic + Platt regression per forecaster, refit daily. Verified Brier 0.157 → 0.088 in walk-forward. The confidence number is an actual probability.",
  },
  {
    accent: "bear",
    title: "Deterministic Risk Agent",
    body: "11 hard checks before every contract: allocation, concurrent positions, drawdown caps, news blackouts, kill switch. The AI cannot bypass it.",
  },
  {
    accent: "bull",
    title: "Voice + tools, sub-second",
    body: "Tap the phone icon, talk to Alpha about a loss, he searches the web mid-call, files a memory, and updates an agent. Under a second to first response.",
  },
  {
    accent: "accent",
    title: "Goal-aware sizing",
    body: "Set a daily profit target. The decision loop throttles stakes as you approach it (≥80% halves, ≥100% skips). Per-firm and per-agent.",
  },
  {
    accent: "warning",
    title: "Your keys, your spend",
    body: "Paste your own broker + AI provider keys at /settings. Above-tier tokens cost you $0 from us — only Stripe sees the base subscription.",
  },
];

const METRICS = [
  { label: "Forecasters running", value: "3", sub: "independent · voted" },
  { label: "Backtested windows", value: "1.5M+", sub: "across 14 instruments" },
  { label: "Brier reduction", value: "44%", sub: "after calibration" },
  { label: "Voice cold start", value: "<1s", sub: "real-time bidirectional" },
];

type HonestyTone = "warn" | "bear" | "info" | "bull";

const HONESTY: {
  title: string;
  body: string;
  tag: string;
  tone: HonestyTone;
  metric?: { label: string; value: string; tone: "good" | "warn" };
}[] = [
  {
    title: "No backtest shows reliable real-money edge yet.",
    body: "Walk-forward across 1.5M+ windows lands at 51–55% hit-rate before fees. Paper-mode is the default; flipping to real money requires a WebAuthn passkey.",
    tag: "Caveat",
    tone: "warn",
    metric: { label: "Hit-rate band:", value: "51–55%", tone: "warn" },
  },
  {
    title: "Calibration helps; it doesn't print money.",
    body: "Brier 0.157 → 0.088 means the confidence number is meaningful — not that 0.65 wins 65% of the time before that fix.",
    tag: "Nuance",
    tone: "info",
    metric: { label: "Brier:", value: "0.157 → 0.088", tone: "good" },
  },
  {
    title: "AI is not financial advice.",
    body: "Every chat surface says so. The Risk Agent is deterministic; the AI cannot bypass it. The kill switch is one click on every page.",
    tag: "Legal",
    tone: "bear",
  },
  {
    title: "Your keys, your bill.",
    body: "Paste your own broker + AI provider keys in Settings and we charge $0 for tokens or trades. The base tier covers our infrastructure only.",
    tag: "Promise",
    tone: "bull",
    metric: { label: "Token markup:", value: "$0", tone: "good" },
  },
];

type ToneT = "bull" | "bear" | "accent" | "muted" | "warning";

const ACCENT_CLASS: Record<string, string> = {
  accent:  "bg-accent",
  bull:    "bg-bull",
  bear:    "bg-bear",
  warning: "bg-warning",
};

/** IntersectionObserver-driven fade-up for any descendant with
 *  `data-reveal`. */
function useReveal() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).dataset.show = "true";
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    for (const t of targets) io.observe(t);
    return () => io.disconnect();
  }, []);
  return rootRef;
}

export default function Landing() {
  const rootRef = useReveal();

  return (
    <div ref={rootRef} className="min-h-screen overflow-x-hidden bg-bg text-text">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-lg font-semibold tracking-tight">TradeMaster</span>
            <span className="rounded-full bg-bull/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-bull">
              public beta
            </span>
          </Link>
          <nav className="flex items-center gap-5 text-sm text-text-dim">
            <a href="#how" className="hover:text-text">How it works</a>
            <a href="#features" className="hover:text-text">Product</a>
            <a href="#pricing" className="hover:text-text">Pricing</a>
            <Link href="/login" className="hover:text-text">Sign in</Link>
            <Link href="/signup"
              className="rounded-md bg-bull px-3 py-1.5 font-medium text-bg shadow-glow hover:opacity-90">
              Start free
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border">
        {/* layered background: mesh + grid + noise + three flares + scan + streams */}
        <div className="tm-mesh absolute inset-0 opacity-95" aria-hidden />
        <div className="tm-grid absolute inset-0 opacity-100" aria-hidden />
        <div className="tm-noise absolute inset-0" aria-hidden />
        <div className="tm-flare-a absolute left-[8%] top-[5%] h-[560px] w-[560px]" aria-hidden />
        <div className="tm-flare-b absolute right-[5%] bottom-[5%] h-[640px] w-[640px]" aria-hidden />
        <div className="tm-flare-c absolute left-1/2 top-1/3 h-[520px] w-[520px] -translate-x-1/2" aria-hidden />
        {/* horizontal scan-line + three vertical data streams = "live system" feel */}
        <div className="tm-scan top-1/4" aria-hidden />
        <div className="tm-stream" style={{ left: "12%", animationDelay: "0s"   }} aria-hidden />
        <div className="tm-stream" style={{ left: "28%", animationDelay: "2.4s" }} aria-hidden />
        <div className="tm-stream" style={{ left: "46%", animationDelay: "4.1s" }} aria-hidden />

        {/* Globe sits as the dominant background visual — bleeds past
            the section's right edge and sits behind the foreground
            copy. Hidden on small screens (canvas perf + layout). */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-[-12%] top-1/2 hidden -translate-y-1/2 opacity-90 md:block lg:right-[-8%]"
        >
          <GlobeVisual size={820} />
        </div>

        {/* Soft right-side gradient so the copy stays readable over
            the globe's brightest pixels. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 right-1/3 hidden bg-gradient-to-r from-bg via-bg/70 to-transparent md:block"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/30 to-bg" aria-hidden />

        <div className="relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-6xl flex-col px-6 pb-6 pt-6 sm:pb-8 sm:pt-6">
          {/* AI-forecast candle card pinned to the upper-right of the
              hero. Absolute so it doesn't push the headline down. */}
          <div
            data-reveal
            className="pointer-events-auto absolute right-6 top-6 z-10 hidden lg:block"
          >
            <CandleMini />
          </div>

          {/* Headline + copy. Starts directly under the nav; no
              vertical centering. */}
          <div className="max-w-2xl" data-reveal>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-bull/40 bg-bull/10 px-3 py-1 text-[10px] uppercase tracking-widest text-bull">
              <span className="tm-pulse-ring h-1.5 w-1.5 rounded-full bg-bull" />
              The first AI firm with real meetings
            </div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl xl:text-7xl">
              Trade with a <span className="text-accent">team of AI agents</span> that{" "}
              <span className="text-bull">meet, review, and rewrite</span> each other.
            </h1>
            <p className="mt-5 max-w-xl text-base text-text-dim sm:text-lg">
              Every other "AI trading" tool is one model in a costume.
              TradeMaster is a firm: a manager agent, employee traders, a
              risk officer. They sit down for 1:1 meetings every 4 hours.
              They write postmortems. They argue. You are the CEO.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/signup"
                className="rounded-md bg-bull px-6 py-3 text-sm font-medium text-bg shadow-glow hover:opacity-90">
                Start free — no card
              </Link>
              <a href="#how"
                className="rounded-md border border-border bg-bg-card/40 px-6 py-3 text-sm text-text-dim backdrop-blur hover:border-accent/40 hover:text-text">
                See an AI meeting
              </a>
              <span className="text-xs text-text-mute">
                · paper-mode default · your keys, your spend
              </span>
            </div>
          </div>

          {/* mt-auto pushes the metric strip to the bottom of the
              viewport so it sits above the fold without enlarging the
              gap at the top. */}
          <div data-reveal className="mt-auto grid shrink-0 grid-cols-2 gap-3 pt-10 sm:grid-cols-4">
            {METRICS.map((m) => (
              <div
                key={m.label}
                className="group relative overflow-hidden rounded-xl border border-border bg-bg-card/80 p-3 backdrop-blur transition hover:border-accent/40"
              >
                <span
                  className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent opacity-60 transition group-hover:opacity-100"
                  aria-hidden
                />
                <div className="num text-xl font-semibold sm:text-2xl">{m.value}</div>
                <div className="mt-1 text-[10px] uppercase tracking-widest text-text-mute">
                  {m.label}
                </div>
                <div className="mt-0.5 text-xs text-text-dim">{m.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────── */}
      <section id="how" className="border-b border-border py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div data-reveal className="mb-12 max-w-2xl">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">
              How it works
            </div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              A trading desk that runs itself, with audit logs you can scroll.
            </h2>
            <p className="mt-3 text-sm text-text-dim">
              Three layers. Forecasters watch the tape. Employees propose
              contracts. The manager reviews them, holds meetings with the
              underperformers, and changes their strategy. Every decision
              traceable to its prompt.
            </p>
          </div>

          <div data-reveal className="grid gap-4 lg:grid-cols-3">
            <OrgCard
              tag="Read" title="Forecasters"
              lines={[
                "Three independent models",
                "Score the next 60 seconds",
                "Calibrated to real probabilities",
              ]}
              caption="Each tick fans out to all three. The Risk Agent only lets a contract through when they agree past your threshold."
            />
            <OrgCard
              tag="Propose" title="Employees" accent
              lines={[
                "Trendy · momentum + Bollinger",
                "Kronny · mean-revert on slow forecaster",
                "Brakey · vol-target, news-aware",
                "Rocky · multiplier swing",
                "Rev · pair-trade scout",
              ]}
              caption="Each agent picks a forecaster + payoff threshold + per-day Kelly cap."
            />
            <OrgCard
              tag="Review" title="Alpha (Manager)"
              lines={[
                "Every 4h → 1:1 with worst hitter",
                "Adjusts Kelly + payoff target",
                "Files mem0 memories",
                "Postmortem on every loss",
                "You, the CEO, can chat or call him",
              ]}
              caption="Tool-calls actually update the database. No 'as an AI language model' — actions land in trade_intents."
            />
          </div>

          <div data-reveal className="mt-10 rounded-2xl border border-border bg-bg-card p-6">
            <div className="text-[10px] uppercase tracking-widest text-bull">A real 1:1 (transcript excerpt)</div>
            <div className="mt-3 grid gap-2 font-mono text-[12px]">
              <Bubble who="Alpha" tone="accent">Trendy, your hit-rate dropped from 58% to 47% this week. Show me your last five losses on frxEURUSD.</Bubble>
              <Bubble who="Trendy" tone="muted">Four were entries near 1.0850 — Bollinger upper kissed but trend strength was lagging. The fifth was post-CPI; I should've been silent.</Bubble>
              <Bubble who="Alpha" tone="accent">Right. I'm raising your payoff target from 1.8 → 2.2 and adding a 30-min calendar blackout around USD CPI. Effective now. Recap next review.</Bubble>
              <Bubble who="Trendy" tone="muted">Understood. Recap saved as memory.</Bubble>
            </div>
            <div className="mt-4 text-xs text-text-mute">
              ↑ Verbatim from a real meeting transcript. The two tool-calls
              actually executed against the database — strategy table updated,
              calendar blackout added.
            </div>
          </div>
        </div>
      </section>

      {/* ── Features grid (no emoji icons; colored accent stripe) ── */}
      <section id="features" className="border-b border-border bg-bg-elev-1 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div data-reveal className="mb-12 max-w-2xl">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">Features</div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Eight things every other trading bot gets wrong.
            </h2>
            <p className="mt-3 text-sm text-text-dim">
              Each one is shipped today, verified live on a real Deriv
              demo account, and runs on your laptop via Docker Compose
              if you want to read the source.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                data-reveal
                style={{ transitionDelay: `${(i % 4) * 60}ms` }}
                className="group relative overflow-hidden rounded-2xl border border-border bg-bg-card p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow"
              >
                {/* Accent stripe replaces the previous emoji — color codes
                    the card kind without the cartoonish chrome. */}
                <span
                  className={`absolute left-0 top-0 h-full w-1 ${ACCENT_CLASS[f.accent] ?? "bg-accent"} opacity-70 transition group-hover:opacity-100`}
                  aria-hidden
                />
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-text-dim">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────── */}
      <section id="pricing" className="border-b border-border py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div data-reveal className="mb-12 max-w-2xl">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">Pricing</div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Hybrid pricing — pay for outcomes, not seats.
            </h2>
            <p className="mt-3 text-sm text-text-dim">
              Per-seat is dying in the AI-agent era. Every tier is a small
              monthly base plus a generous usage envelope. Bring your own
              AI provider & broker keys at any tier and stop paying us for
              tokens entirely.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TIERS.map((t, i) => (
              <div
                key={t.name}
                data-reveal
                style={{ transitionDelay: `${i * 70}ms` }}
                className={`relative rounded-2xl border p-6 transition hover:-translate-y-1 ${
                  t.highlight
                    ? "border-bull/60 bg-bg-card shadow-glow"
                    : "border-border bg-bg-card hover:border-accent/40"
                }`}
              >
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
                  {t.features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2 text-xs text-text-dim">
                      <span className="mt-0.5 text-bull">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p data-reveal className="mt-8 text-xs text-text-mute">
            All tiers include calibration, postmortems, the activity feed, WebAuthn passkey gate, and the Edge report.
            BYO broker + AI provider keys at any tier from <span className="num">/settings</span>.
          </p>
        </div>
      </section>

      {/* ── Honesty block ────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border bg-bg-elev-1 py-24">
        {/* Backdrop layers — same family as the hero but quieter so the
            copy stays the focus. */}
        <div className="tm-grid absolute inset-0 opacity-70" aria-hidden />
        <div className="tm-flare-c absolute -left-[10%] top-1/4 h-[420px] w-[420px]" aria-hidden />
        <div className="tm-flare-b absolute -right-[10%] bottom-0 h-[480px] w-[480px]" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-b from-bg-elev-1/40 via-transparent to-bg-elev-1" aria-hidden />

        <div className="relative mx-auto max-w-5xl px-6">
          <div data-reveal className="mb-12 max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 text-[10px] uppercase tracking-widest text-accent">
              <span className="tm-pulse-ring h-1.5 w-1.5 rounded-full bg-accent" />
              Honesty
            </div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              What we <span className="text-bear">won&apos;t pretend</span>.
            </h2>
            <p className="mt-3 text-sm text-text-dim">
              Trading platforms over-promise. We list the limits up front so
              you can decide what to risk.
            </p>
          </div>

          {/* 2×2 asymmetric grid — each card gets a status stripe + icon */}
          <div className="grid gap-4 md:grid-cols-2">
            {HONESTY.map((h, i) => (
              <div
                key={h.title}
                data-reveal
                style={{ transitionDelay: `${i * 80}ms` }}
                className="group relative overflow-hidden rounded-2xl border border-border bg-bg-card/80 p-5 backdrop-blur transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow"
              >
                {/* status stripe (left edge) — color codes the kind of caveat */}
                <span
                  className={`absolute left-0 top-0 h-full w-1 ${
                    h.tone === "warn" ? "bg-warning"
                    : h.tone === "bear" ? "bg-bear"
                    : h.tone === "info" ? "bg-accent"
                    : "bg-bull"
                  } opacity-80 transition group-hover:opacity-100`}
                  aria-hidden
                />
                {/* top-edge glow line that pulses on hover */}
                <span
                  className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent opacity-50 transition group-hover:opacity-100"
                  aria-hidden
                />

                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text">{h.title}</h3>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                      h.tone === "warn" ? "bg-warning-soft text-warning"
                      : h.tone === "bear" ? "bg-bear-soft text-bear"
                      : h.tone === "info" ? "bg-accent-soft text-accent"
                      : "bg-bull-soft text-bull"
                    }`}
                  >
                    {h.tag}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-text-dim">{h.body}</p>
                {h.metric && (
                  <div className="mt-3 inline-flex items-baseline gap-2 rounded-md border border-border bg-bg-elev-2/60 px-2.5 py-1 text-[11px]">
                    <span className="text-text-mute">{h.metric.label}</span>
                    <span className={`num ${h.metric.tone === "good" ? "text-bull" : "text-warning"}`}>
                      {h.metric.value}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA strip ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border py-20">
        <div className="tm-mesh absolute inset-0 opacity-90" aria-hidden />
        <div className="tm-flare-a absolute left-1/4 top-1/4 h-[420px] w-[420px]" aria-hidden />
        <div className="tm-flare-b absolute right-1/4 bottom-1/4 h-[380px] w-[380px]" aria-hidden />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <h2 data-reveal className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Spin up a paper firm in 60 seconds.
          </h2>
          <p data-reveal className="mx-auto mt-3 max-w-2xl text-sm text-text-dim">
            Seven starter agents seeded automatically: Alpha (manager),
            Trendy, Brakey, Rocky, Rev, Action, and Scout. Real Deriv ticks,
            real forecasts, real risk gates. Zero risk of money loss until
            you flip the passkey.
          </p>
          <div data-reveal className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup"
              className="rounded-md bg-bull px-6 py-3 text-sm font-medium text-bg shadow-glow hover:opacity-90">
              Start free
            </Link>
            <Link href="/login"
              className="rounded-md border border-border px-6 py-3 text-sm text-text-dim hover:border-accent/40 hover:text-text">
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

/** Photorealistic WebGL globe via cobe (the Vercel-built library that
 *  powers most premium fintech "world map" hero visuals). Real
 *  continents drawn as dots, with atmospheric glow, lighting, and a
 *  slow auto-rotate. Hub markers pulse at the world's biggest market
 *  cities. */
function GlobeVisual({ size = 680 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // We keep phi in a ref so the cobe onRender callback can mutate it
  // without React state churn.
  const phiRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let globe: { destroy: () => void } | null = null;

    // cobe is browser-only (WebGL). Lazy-import so SSR doesn't crash.
    import("cobe").then(({ default: createGlobe }) => {
      if (cancelled || !canvasRef.current) return;
      globe = createGlobe(canvasRef.current, {
        devicePixelRatio: Math.min(2, window.devicePixelRatio || 1),
        width: size * 2,
        height: size * 2,
        phi: 0,
        theta: 0.25,
        dark: 1,
        diffuse: 1.4,
        mapSamples: 18000,
        mapBrightness: 6,
        baseColor:   [0.18, 0.22, 0.34],  // continent surface
        markerColor: [0.15, 0.65, 0.59],  // trading hubs (bull/teal)
        glowColor:   [0.16, 0.38, 1.0],   // accent-blue atmosphere
        markers: [
          { location: [ 40.7128,  -74.0060], size: 0.06 }, // NY
          { location: [ 51.5072,   -0.1276], size: 0.06 }, // London
          { location: [ 50.1109,    8.6821], size: 0.05 }, // Frankfurt
          { location: [ 35.6762,  139.6503], size: 0.06 }, // Tokyo
          { location: [ 22.3193,  114.1694], size: 0.05 }, // Hong Kong
          { location: [  1.3521,  103.8198], size: 0.05 }, // Singapore
          { location: [-33.8688,  151.2093], size: 0.05 }, // Sydney
          { location: [-23.5505,  -46.6333], size: 0.05 }, // São Paulo
          { location: [-26.2041,   28.0473], size: 0.04 }, // Johannesburg
          { location: [ 25.2048,   55.2708], size: 0.05 }, // Dubai
        ],
        // ~80s per revolution for a cinematic rotation at this size.
        onRender: (state) => {
          state.phi = phiRef.current;
          phiRef.current += 0.0008;
        },
      });
    }).catch(() => { /* cobe load failed — hero just shows backdrops */ });

    return () => {
      cancelled = true;
      globe?.destroy();
    };
  }, [size]);

  return (
    <div className="relative" style={{ width: size, height: size }}>
      {/* Wide outer halo backlight reaching beyond the canvas. */}
      <div
        className="absolute -inset-32 -z-10 rounded-full bg-accent/25 blur-[140px]"
        aria-hidden
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        style={{ width: size, height: size, contain: "layout paint size" }}
        className="block"
      />
    </div>
  );
}

/** Big animated candlestick "AI prediction" panel — sits at the top
 *  of the hero. 18 historical candles, a live-pulse on the most
 *  recent one, a dashed AI-forecast projection extending to the
 *  right, and a moving "scanner" line that sweeps across to evoke
 *  real-time analysis. */
function CandleMini() {
  // Deterministic but pseudo-random candle pattern (hand-tuned for shape).
  const candles = [
    { y: 58, h: 22, color: "bear" },
    { y: 56, h: 20, color: "bear" },
    { y: 52, h: 26, color: "bull" },
    { y: 46, h: 18, color: "bull" },
    { y: 50, h: 22, color: "bear" },
    { y: 44, h: 20, color: "bull" },
    { y: 38, h: 18, color: "bull" },
    { y: 42, h: 22, color: "bear" },
    { y: 36, h: 20, color: "bull" },
    { y: 30, h: 18, color: "bull" },
    { y: 26, h: 24, color: "bull" },
    { y: 30, h: 18, color: "bear" },
    { y: 22, h: 22, color: "bull" },
    { y: 18, h: 18, color: "bull" },
    { y: 14, h: 24, color: "bull" },
    { y: 20, h: 16, color: "bear" },
    { y: 10, h: 20, color: "bull" },
    { y: 6,  h: 16, color: "bull" },
  ];
  const cellW = 18;
  const padL = 14;
  const totalW = padL + candles.length * cellW + 90;
  const totalH = 120;
  // Forecast (dashed projection) — 5 future bars extending the trend
  // slightly upward and widening into an uncertainty cone.
  const last = candles[candles.length - 1];
  const lastTop = last.y;
  const forecastPts = [
    { x: padL + candles.length * cellW + 4,  y: lastTop - 4 },
    { x: padL + candles.length * cellW + 22, y: lastTop - 10 },
    { x: padL + candles.length * cellW + 40, y: lastTop - 16 },
    { x: padL + candles.length * cellW + 58, y: lastTop - 22 },
    { x: padL + candles.length * cellW + 76, y: lastTop - 28 },
  ];
  return (
    <div className="relative w-[460px] overflow-hidden rounded-2xl border border-accent/30 bg-bg-card/85 p-4 shadow-2xl backdrop-blur">
      {/* AI badge corner */}
      <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-accent">
        <span className="tm-pulse-ring h-1 w-1 rounded-full bg-accent" />
        AI predicting
      </div>

      {/* Header line */}
      <div className="mb-2 flex items-center gap-2 text-[10px] text-text-mute">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bull" />
        ETH / USD · 1m · live
      </div>

      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        className="block h-[140px] w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="cand-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#26A69A" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#26A69A" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="cand-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="#26A69A" />
            <stop offset="100%" stopColor="#7DD3FC" />
          </linearGradient>
          <radialGradient id="cand-pulse" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="#7DD3FC" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#7DD3FC" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Subtle grid */}
        {[20, 40, 60, 80, 100].map((y) => (
          <line key={y} x1="0" y1={y} x2={totalW} y2={y}
            stroke="rgba(148,163,255,0.06)" strokeWidth="1" />
        ))}

        {/* Trend area-fill behind candles */}
        <path
          d={
            "M " + padL + " " + totalH +
            " " + candles.map((c, i) => `L ${padL + i * cellW + cellW / 2} ${c.y}`).join(" ") +
            ` L ${padL + candles.length * cellW} ${totalH} Z`
          }
          fill="url(#cand-area)"
        />

        {/* Candles */}
        {candles.map((c, i) => {
          const isLast = i === candles.length - 1;
          const fill = c.color === "bull" ? "#26A69A" : "#EF5350";
          return (
            <g key={i} className="tm-candle" style={{ ["--i" as never]: i } as React.CSSProperties}>
              <line
                x1={padL + i * cellW + cellW / 2} y1={c.y - 4}
                x2={padL + i * cellW + cellW / 2} y2={c.y + c.h + 4}
                stroke={fill} strokeWidth="1"
              />
              <rect
                x={padL + i * cellW + 3} y={c.y}
                width={cellW - 6} height={c.h}
                fill={fill}
                opacity={isLast ? 0.95 : 0.85}
              />
              {isLast && (
                /* Pulsing glow halo on the last (live) candle. */
                <circle
                  cx={padL + i * cellW + cellW / 2}
                  cy={c.y + c.h / 2}
                  r="18"
                  fill="url(#cand-pulse)"
                >
                  <animate attributeName="r" values="14;22;14" dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0.9;0.6" dur="2.2s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}

        {/* Anchor at the last close */}
        <circle cx={padL + (candles.length - 1) * cellW + cellW / 2} cy={lastTop}
          r="3" fill="#7DD3FC" />

        {/* AI forecast — dashed projection + uncertainty band */}
        <polyline
          points={forecastPts.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none" stroke="url(#cand-line)" strokeWidth="2" strokeDasharray="4 4"
        >
          <animate attributeName="stroke-dashoffset" from="0" to="-16" dur="1.6s" repeatCount="indefinite" />
        </polyline>
        {/* Upper / lower uncertainty edges (semi-transparent dashes) */}
        <polyline
          points={forecastPts.map((p, i) => `${p.x},${p.y - 6 - i * 0.8}`).join(" ")}
          fill="none" stroke="#7DD3FC" strokeWidth="1" strokeDasharray="2 4" opacity="0.45"
        />
        <polyline
          points={forecastPts.map((p, i) => `${p.x},${p.y + 6 + i * 0.8}`).join(" ")}
          fill="none" stroke="#7DD3FC" strokeWidth="1" strokeDasharray="2 4" opacity="0.45"
        />

        {/* Moving scanner line — sweeps left→right repeatedly */}
        <g>
          <line x1="0" y1="0" x2="0" y2={totalH}
            stroke="rgba(125,211,252,0.55)" strokeWidth="1.5">
            <animate attributeName="x1" values={`0;${totalW}`} dur="4.2s" repeatCount="indefinite" />
            <animate attributeName="x2" values={`0;${totalW}`} dur="4.2s" repeatCount="indefinite" />
          </line>
        </g>
      </svg>

      {/* Footer row — price + delta + horizon */}
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <div className="flex items-baseline gap-2">
          <span className="num text-bull">▲ +0.31%</span>
          <span className="num text-text-mute">2,019.84</span>
        </div>
        <div className="flex items-center gap-2 text-text-mute">
          <span>forecast · next 96s</span>
          <span className="num text-accent">conf 63%</span>
        </div>
      </div>
    </div>
  );
}

function OrgCard({
  title, tag, lines, caption, accent = false,
}: {
  title: string; tag: string;
  lines: string[]; caption: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border bg-bg-card p-5 transition hover:-translate-y-0.5 ${
      accent ? "border-bull/40 shadow-glow" : "border-border hover:border-accent/40"
    }`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
          accent ? "bg-bull/15 text-bull" : "bg-accent/15 text-accent"
        }`}>{tag}</span>
      </div>
      <ul className="mt-3 space-y-1 text-xs text-text-dim">
        {lines.map((l) => (
          <li key={l} className="flex items-start gap-2">
            <span className="mt-1 h-1 w-1 rounded-full bg-text-mute" />
            <span>{l}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-text-mute">{caption}</p>
    </div>
  );
}

function Bubble({
  who, tone, children,
}: { who: string; tone: ToneT; children: React.ReactNode }) {
  const toneCls = tone === "accent" ? "text-accent" : "text-text";
  return (
    <div className="flex gap-3">
      <span className={`shrink-0 w-16 text-[11px] uppercase tracking-widest ${toneCls}`}>
        {who}
      </span>
      <span className="text-text-dim">{children}</span>
    </div>
  );
}

/** Smart CTA: logged-out users go to /signup with a ?tier= hint; logged-in
 *  users with a company go straight to a Stripe checkout session for that
 *  tier. Free + Enterprise always behave as static links. */
function TierCTA({ tier }: { tier: typeof TIERS[number] }) {
  const { me, activeCompanyId } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStripe = tier.name === "Starter" || tier.name === "Pro";
  const showCheckout = isStripe && me && activeCompanyId;

  const baseCls = `mt-5 block rounded-md py-2 text-center text-xs font-medium transition ${
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
