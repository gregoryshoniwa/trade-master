"use client";

/**
 * Public landing page rendered at `/` for logged-out visitors.
 *
 * Positioning: TradeMaster is the first trading platform where AI
 * agents hold *real meetings* about your account — managers reviewing
 * employees, employees presenting plans, postmortems on every loss.
 * Other AI-trading tools are single-bot black boxes; this one shows
 * its working.
 *
 * Motion: hand-rolled CSS in globals.css (`tm-mesh`, `tm-float`,
 * `tm-stream-line`, `[data-reveal]`) + one IntersectionObserver here
 * for scroll fade-ins. No Framer Motion / GSAP bundle to ship.
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
    icon: "🤝",
    title: "AI 1:1 meetings",
    body: "Alpha sits down with each agent every 4 hours, reads the postmortems, and rewrites their strategy. You scroll the transcript like a Notion doc.",
  },
  {
    icon: "🤖",
    title: "Auto-executing manager",
    body: "When Alpha decides Kronny's min-payoff should move from 2.0 to 2.5, he updates the row. No human in the loop, audit trail on every change.",
  },
  {
    icon: "📊",
    title: "Three forecasters, voted",
    body: "TTM, Kronos, and the TSFM ensemble (Chronos-2 + Moirai-2). Each agent picks one; the Risk Agent demands they agree past your threshold.",
  },
  {
    icon: "🎯",
    title: "Conformal calibration",
    body: "Isotonic + Platt per forecaster, refit daily. Verified Brier 0.157 → 0.088. The 'confidence' number you see is actually a probability.",
  },
  {
    icon: "🛡️",
    title: "Deterministic Risk Agent",
    body: "11 hard checks before every contract: allocation, concurrent positions, drawdown caps, news blackouts, kill switch. The LLM cannot bypass it.",
  },
  {
    icon: "📞",
    title: "Voice + tools in 1s",
    body: "Tap the phone icon, talk to Alpha about a loss, he searches the web mid-call, files a memory, and updates an agent. Sub-second to first response.",
  },
  {
    icon: "📈",
    title: "Goal-aware sizing",
    body: "Set a daily profit target. The decision loop throttles stakes as you approach it (≥80% halves, ≥100% skips). Per-firm and per-agent.",
  },
  {
    icon: "🔓",
    title: "Your keys, your spend",
    body: "Paste your own Deriv + Anthropic + Gemini keys at /settings. Above-tier tokens cost you $0 from us — only Stripe sees the base subscription.",
  },
];

const METRICS = [
  { label: "Forecasters running", value: "3", sub: "TTM · Kronos · TSFM" },
  { label: "Backtested windows", value: "1.5M+", sub: "across 14 instruments" },
  { label: "Brier reduction", value: "44%", sub: "after calibration" },
  { label: "Voice cold start", value: "<1s", sub: "Gemini Live ephemeral" },
];

const STREAM_LINES: { t: string; text: string; tone: ToneT }[] = [
  { t: "14:32", text: "Alpha · scheduled review · 6 employees", tone: "muted" },
  { t: "14:32", text: "▲ get_team_status — Kronny 41/47W +$325 hit 40%", tone: "bull" },
  { t: "14:33", text: "→ adjust_employee Kronny min_payoff 2.0 → 2.5", tone: "accent" },
  { t: "14:33", text: "  \"low hit rate saved by payoff; tighten asymmetry\"", tone: "muted" },
  { t: "14:33", text: "→ hold_meeting_with_employee Trendy frxEURUSD", tone: "accent" },
  { t: "14:33", text: "▲ web_search \"ECB rate decision impact EUR\"", tone: "bull" },
  { t: "14:34", text: "  3 results from ecb.europa.eu, reuters.com", tone: "muted" },
  { t: "14:34", text: "▲ TSFM ensemble forecast cryBTCUSD ↑ conf 0.62", tone: "bull" },
  { t: "14:35", text: "  Trendy intent · MULTUP cryBTCUSD $20 · pending_approval", tone: "accent" },
  { t: "14:35", text: "  ✕ no_concurrent_position — already long cryBTCUSD", tone: "bear" },
  { t: "14:35", text: "Review done · 3 actions · transcript saved", tone: "muted" },
];

type ToneT = "bull" | "bear" | "accent" | "muted";

/** Watch wrapped children for IntersectionObserver visibility and stamp
 *  `data-show=true` on each, which CSS uses to fade-up. One observer
 *  per page; never re-creates DOM. */
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

      {/* ── Hero ───────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="tm-mesh absolute inset-0 opacity-90" aria-hidden />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/50 to-bg" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-6 py-20 sm:py-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.2fr_1fr]">
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
                TradeMaster is a firm: a manager agent, employee traders, a risk
                officer. They sit down for 1:1 meetings every 4 hours. They
                write postmortems. They argue. You are the CEO.
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

            {/* Animated streaming console — looks like the live activity
                feed, with each line wiped in on its own delay. */}
            <div data-reveal className="tm-float rounded-2xl border border-border bg-bg-card p-4 shadow-2xl">
              <div className="mb-2 flex items-center gap-2 text-[10px] text-text-mute">
                <span className="h-2 w-2 rounded-full bg-bear" />
                <span className="h-2 w-2 rounded-full bg-warning" />
                <span className="h-2 w-2 rounded-full bg-bull" />
                <span className="ml-2 font-mono">Phase1 Test · live</span>
              </div>
              <div className="space-y-1 font-mono text-[11px] leading-relaxed">
                {STREAM_LINES.map((l, i) => (
                  <div
                    key={i}
                    className="tm-stream-line"
                    style={{ animationDelay: `${i * 90}ms` }}
                  >
                    <ToneLine tone={l.tone}>
                      [{l.t}] {l.text}
                    </ToneLine>
                  </div>
                ))}
              </div>
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

      {/* ── How it works — animated org chart + meeting walk ─── */}
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

          {/* Org-chart-ish visual: 3 columns. Each card animates in.
              No SVG paths — pure rounded boxes + arrows via borders so
              it stays sharp at any screen size. */}
          <div data-reveal className="grid gap-4 lg:grid-cols-3">
            <OrgCard
              icon="📡" title="Forecasters" tag="Read"
              lines={[
                "TTM · 30-second window",
                "Kronos · 5-tick chronological",
                "TSFM · multivariate ensemble",
              ]}
              caption="Each tick fans out to NATS. Three models score the next 60s independently."
            />
            <OrgCard
              icon="🧑‍💼" title="Employees" tag="Propose"
              lines={[
                "Trendy · momentum + Bollinger",
                "Kronny · mean-revert on Kronos",
                "Brakey · vol-target, news-aware",
                "Rocky · multiplier swing",
                "Rev · pair-trade scout",
              ]}
              caption="Each agent picks a forecaster + payoff threshold + per-day Kelly cap."
              accent
            />
            <OrgCard
              icon="👔" title="Alpha (Manager)" tag="Review"
              lines={[
                "Every 4h → 1:1 with worst hitter",
                "Adjusts Kelly + min-payoff",
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
              <Bubble who="Alpha" tone="accent">Right. I'm raising your min_payoff from 1.8 → 2.2 and adding a 30-min calendar blackout around USD CPI. Effective now. Recap next review.</Bubble>
              <Bubble who="Trendy" tone="muted">Understood. Recap saved as memory.</Bubble>
            </div>
            <div className="mt-4 text-xs text-text-mute">
              ↑ This is verbatim from a real meeting transcript. Alpha's tool-calls executed —
              <span className="num"> adjust_employee Trendy min_payoff=2.2</span>{" "}
              and <span className="num">add_calendar_blackout USD CPI 30m</span>.
            </div>
          </div>
        </div>
      </section>

      {/* ── Features grid (kept tight) ─────────────────────────── */}
      <section id="features" className="border-b border-border bg-bg-elev-1 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div data-reveal className="mb-12 max-w-2xl">
            <div className="mb-3 text-[10px] uppercase tracking-widest text-accent">Features</div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Eight things every other trading bot gets wrong.
            </h2>
            <p className="mt-3 text-sm text-text-dim">
              Each one is shipped today, verified live on a Deriv demo
              account, and runs on your laptop via Docker Compose if you
              want to read the source.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                data-reveal
                style={{ transitionDelay: `${(i % 4) * 60}ms` }}
                className="rounded-2xl border border-border bg-bg-card p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-glow"
              >
                <div className="text-2xl">{f.icon}</div>
                <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-text-dim">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────── */}
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
              LLM & broker keys at any tier and stop paying us for tokens entirely.
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
            BYO Deriv + LLM keys at any tier from <span className="num">/settings</span>.
          </p>
        </div>
      </section>

      {/* ── Honesty block ────────────────────────────────────── */}
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
              { strong: "No backtest shows reliable real-money edge yet.", body: " Walk-forward across 1.5M+ windows lands at 51–55% hit-rate band before fees. Paper-mode is the default; flipping to real money requires a WebAuthn passkey." },
              { strong: "Calibration helps; it doesn't print money.", body: " Brier 0.157 → 0.088 means the confidence number is meaningful — not that 0.65 wins 65% of the time before that fix." },
              { strong: "AI is not financial advice.", body: " Every chat surface says so. The Risk Agent is deterministic; the LLM cannot bypass it. The kill switch is one click on every page." },
              { strong: "Your keys, your bill.", body: " Paste your own Deriv + LLM keys in Settings and we charge $0 for tokens or trades. The base tier covers our infrastructure only." },
            ].map((row, i) => (
              <li key={i} data-reveal style={{ transitionDelay: `${i * 80}ms` }}
                className="rounded-md border border-border bg-bg-card p-4">
                <span className="text-text">{row.strong}</span>{row.body}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── CTA strip ───────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-border py-20">
        <div className="tm-mesh absolute inset-0 opacity-60" aria-hidden />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <h2 data-reveal className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Spin up a paper firm in 60 seconds.
          </h2>
          <p data-reveal className="mx-auto mt-3 max-w-2xl text-sm text-text-dim">
            Seven starter agents seeded automatically: Alpha (manager),
            Trendy, Brakey, Rocky, Rev, Action, and Scout. Real Deriv ticks,
            real TTM forecasts, real risk gates. Zero risk of money loss until
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

function OrgCard({
  icon, title, tag, lines, caption, accent = false,
}: {
  icon: string; title: string; tag: string;
  lines: string[]; caption: string; accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border bg-bg-card p-5 transition hover:-translate-y-0.5 ${
      accent ? "border-bull/40 shadow-glow" : "border-border hover:border-accent/40"
    }`}>
      <div className="flex items-center justify-between">
        <div className="text-2xl">{icon}</div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
          accent ? "bg-bull/15 text-bull" : "bg-accent/15 text-accent"
        }`}>{tag}</span>
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
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

function ToneLine({
  children, tone,
}: { children: React.ReactNode; tone: ToneT }) {
  const cls = {
    bull:   "text-bull",
    bear:   "text-bear",
    accent: "text-accent",
    muted:  "text-text-mute",
  }[tone];
  return <div className={cls}>{children}</div>;
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
