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
        {/* layered background: mesh + grid + three saturated flares */}
        <div className="tm-mesh absolute inset-0 opacity-95" aria-hidden />
        <div className="tm-grid absolute inset-0 opacity-90" aria-hidden />
        <div className="tm-flare-a absolute left-[8%] top-[5%] h-[560px] w-[560px]" aria-hidden />
        <div className="tm-flare-b absolute right-[5%] bottom-[5%] h-[640px] w-[640px]" aria-hidden />
        <div className="tm-flare-c absolute left-1/2 top-1/3 h-[520px] w-[520px] -translate-x-1/2" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/40 to-bg" aria-hidden />

        <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
            <div data-reveal>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-bull/40 bg-bull/10 px-3 py-1 text-[10px] uppercase tracking-widest text-bull">
                <span className="tm-pulse-ring h-1.5 w-1.5 rounded-full bg-bull" />
                The first AI firm with real meetings
              </div>
              <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Trade with a <span className="text-accent">team of AI agents</span> that{" "}
                <span className="text-bull">meet, review, and rewrite</span> each other.
              </h1>
              <p className="mt-6 max-w-xl text-base text-text-dim sm:text-lg">
                Every other "AI trading" tool is one model in a costume.
                TradeMaster is a firm: a manager agent, employee traders, a
                risk officer. They sit down for 1:1 meetings every 4 hours.
                They write postmortems. They argue. You are the CEO.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup"
                  className="rounded-md bg-bull px-5 py-3 text-sm font-medium text-bg shadow-glow hover:opacity-90">
                  Start free — no card
                </Link>
                <a href="#how"
                  className="rounded-md border border-border px-5 py-3 text-sm text-text-dim hover:border-accent/40 hover:text-text">
                  See an AI meeting
                </a>
                <span className="text-xs text-text-mute">
                  · paper-mode default · your keys, your spend
                </span>
              </div>
            </div>

            {/* Visual: rotating wireframe globe with hubs, overlaid by a
                candlestick mini-chart. Tells the "global markets + AI
                trading" story without stock photography. */}
            <div data-reveal className="relative">
              <GlobeVisual />
              <CandleMini />
            </div>
          </div>

          <div data-reveal className="mt-16 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {METRICS.map((m) => (
              <div key={m.label} className="rounded-xl border border-border bg-bg-card/80 p-4 backdrop-blur transition hover:border-accent/40">
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
      <section className="border-b border-border bg-bg-elev-1 py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div data-reveal>
            <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">Honesty</div>
            <h2 className="text-3xl font-semibold tracking-tight">
              What we won't pretend.
            </h2>
          </div>
          <ul className="mt-6 space-y-4 text-sm text-text-dim">
            {[
              { strong: "No backtest shows reliable real-money edge yet.", body: " Walk-forward across 1.5M+ windows lands at 51–55% hit-rate before fees. Paper-mode is the default; flipping to real money requires a WebAuthn passkey." },
              { strong: "Calibration helps; it doesn't print money.", body: " Brier 0.157 → 0.088 means the confidence number is meaningful — not that 0.65 wins 65% of the time before that fix." },
              { strong: "AI is not financial advice.", body: " Every chat surface says so. The Risk Agent is deterministic; the AI cannot bypass it. The kill switch is one click on every page." },
              { strong: "Your keys, your bill.", body: " Paste your own broker + AI provider keys in Settings and we charge $0 for tokens or trades. The base tier covers our infrastructure only." },
            ].map((row, i) => (
              <li key={i} data-reveal style={{ transitionDelay: `${i * 80}ms` }}
                className="rounded-md border border-border bg-bg-card p-4">
                <span className="text-text">{row.strong}</span>{row.body}
              </li>
            ))}
          </ul>
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

/** Canvas-based dotted globe with depth shading, slow rotation, and
 *  pulsing market hubs. ~700 dots distributed on a sphere via a
 *  Fibonacci lattice; each frame we rotate around the Y axis, project
 *  to 2D, and draw with size + alpha keyed off the dot's z-depth so
 *  the far hemisphere reads as the "back of the globe". */
function GlobeVisual() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // High-DPI: render at devicePixelRatio for crisp dots without
    // bumping the CSS box.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssSize = 380;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    canvas.style.width = `${cssSize}px`;
    canvas.style.height = `${cssSize}px`;
    ctx.scale(dpr, dpr);

    const cx = cssSize / 2;
    const cy = cssSize / 2;
    const R = cssSize * 0.42;

    // Fibonacci lattice — distributes N points evenly on a sphere.
    const N = 700;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const baseDots: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = golden * i;
      baseDots.push({
        x: Math.cos(theta) * radius,
        y: y,
        z: Math.sin(theta) * radius,
      });
    }

    // Market hubs in (lat, lng) degrees. We project these the same
    // way each frame so they rotate with the globe and pulse on top.
    const hubsLL = [
      { lat:  40.7, lng:  -74.0 }, // NY
      { lat:  51.5, lng:   -0.1 }, // London
      { lat:  50.1, lng:    8.7 }, // Frankfurt
      { lat:  35.7, lng:  139.7 }, // Tokyo
      { lat:  22.3, lng:  114.2 }, // Hong Kong
      { lat: -33.9, lng:  151.2 }, // Sydney
      { lat: -23.5, lng:  -46.6 }, // São Paulo
      { lat: -26.2, lng:   28.0 }, // Johannesburg
    ];
    const hubsXYZ = hubsLL.map(({ lat, lng }) => {
      const phi = (lat * Math.PI) / 180;
      const lam = (lng * Math.PI) / 180;
      return {
        x: Math.cos(phi) * Math.cos(lam),
        y: Math.sin(phi),
        z: Math.cos(phi) * Math.sin(lam),
      };
    });

    let rafId = 0;
    let t0 = 0;
    function frame(t: number) {
      if (!t0) t0 = t;
      const elapsed = (t - t0) / 1000;
      // 60s for a full rotation — matches the perceived "earth-like" speed.
      const angle = (elapsed * Math.PI * 2) / 60;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      if (!ctx) return;
      ctx.clearRect(0, 0, cssSize, cssSize);

      // Atmosphere halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.85, cx, cy, R * 1.25);
      halo.addColorStop(0, "rgba(41, 98, 255, 0.18)");
      halo.addColorStop(1, "rgba(41, 98, 255, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, cssSize, cssSize);

      // Sphere body — very dark navy, gives the dots a surface to sit on.
      const body = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
      body.addColorStop(0, "#1a2235");
      body.addColorStop(0.7, "#0f1623");
      body.addColorStop(1, "#0a1020");
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();

      // Dots — rotate around Y, project to 2D, draw with depth shading.
      for (const d of baseDots) {
        const rx = d.x * cosA + d.z * sinA;
        const rz = -d.x * sinA + d.z * cosA;
        const ry = d.y;
        // Front-hemisphere dots are bright; back-hemisphere dim.
        const depth = (rz + 1) / 2; // 0 = far, 1 = near
        const alpha = 0.15 + depth * 0.55;
        const size = 0.6 + depth * 1.4;
        const px = cx + rx * R;
        const py = cy + ry * R;
        // Subtle cyan→blue tint based on latitude so the globe doesn't
        // read as monotone.
        const lat = Math.asin(ry); // -PI/2 .. PI/2
        const hue = 200 + lat * 14;
        ctx.fillStyle = `hsla(${hue.toFixed(0)}, 80%, 70%, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }

      // Subtle equator ring for orientation.
      ctx.strokeStyle = "rgba(180, 200, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * 0.04, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Market hubs — pulse + ring on the front hemisphere only.
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 2.2);
      for (let i = 0; i < hubsXYZ.length; i++) {
        const h = hubsXYZ[i];
        const rx = h.x * cosA + h.z * sinA;
        const rz = -h.x * sinA + h.z * cosA;
        const ry = h.y;
        if (rz < -0.15) continue; // behind the globe
        const px = cx + rx * R;
        const py = cy + ry * R;
        const local = 0.5 + 0.5 * Math.sin(elapsed * 2.2 + i * 0.9);
        // Glow ring
        ctx.strokeStyle = `rgba(38, 166, 154, ${(0.45 * (1 - local)).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 3 + local * 9, 0, Math.PI * 2);
        ctx.stroke();
        // Core
        ctx.fillStyle = `rgba(38, 166, 154, ${(0.85 + 0.15 * pulse).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(px, py, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div className="relative mx-auto h-[380px] w-[380px]">
      {/* Outer halo backlight */}
      <div className="absolute inset-0 -z-10 rounded-full bg-accent/15 blur-3xl" />
      <canvas ref={canvasRef} aria-hidden className="block" />
    </div>
  );
}

/** A compact candlestick mock-chart that sits over the globe to anchor
 *  the "this is a trading product" read. Each candle wipes in via CSS
 *  with a staggered delay. */
function CandleMini() {
  // Hand-tuned candle bodies — pseudo-random but deterministic so SSR
  // and hydration agree.
  const candles = [
    { y: 36, h: 28, color: "bear" },
    { y: 28, h: 22, color: "bear" },
    { y: 22, h: 18, color: "bear" },
    { y: 16, h: 16, color: "bull" },
    { y: 14, h: 22, color: "bull" },
    { y: 10, h: 18, color: "bear" },
    { y: 12, h: 26, color: "bull" },
    { y: 8,  h: 16, color: "bull" },
    { y: 4,  h: 24, color: "bull" },
    { y: 6,  h: 14, color: "bear" },
    { y: 2,  h: 20, color: "bull" },
    { y: 0,  h: 12, color: "bull" },
  ];
  return (
    <div className="pointer-events-none absolute -bottom-4 -right-4 rounded-xl border border-border bg-bg-card/85 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center gap-2 text-[10px] text-text-mute">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bull" />
        Live · 1m
      </div>
      <svg viewBox="0 0 160 70" className="h-[80px] w-[180px]" aria-hidden>
        {candles.map((c, i) => (
          <g key={i} className="tm-candle" style={{ ["--i" as never]: i } as React.CSSProperties}>
            <line x1={i * 13 + 8} y1={c.y - 3} x2={i * 13 + 8} y2={c.y + c.h + 3}
              stroke={c.color === "bull" ? "#26A69A" : "#EF5350"} strokeWidth="1" />
            <rect
              x={i * 13 + 4} y={c.y} width="8" height={c.h}
              fill={c.color === "bull" ? "#26A69A" : "#EF5350"}
            />
          </g>
        ))}
      </svg>
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
