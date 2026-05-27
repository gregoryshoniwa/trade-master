"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { api, type SymbolDef } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// PLAN §8 — nine asset tiers.
type TierDef = {
  tier: number;
  title: string;
  adds: string;          // what's new at this tier
  contracts: string[];   // contract codes unlocked at this tier
};

const TIERS: TierDef[] = [
  { tier: 1, title: "Forex Majors", adds: "EUR/USD, GBP/USD, USD/JPY, USD/CHF", contracts: ["MULTUP", "MULTDOWN"] },
  { tier: 2, title: "Synthetic Indices", adds: "Volatility 75, 1HZ100V, 1HZ150V, 1HZ200V", contracts: ["ACCU"] },
  { tier: 3, title: "Forex Minors + Commodities", adds: "AUD/USD, EUR/GBP, XAU/USD, XAG/USD", contracts: [] },
  { tier: 4, title: "Crypto", adds: "BTC/USD, ETH/USD", contracts: [] },
  { tier: 5, title: "Crash & Boom + Turbos", adds: "Crash 1000, Boom 1000, Crash/Boom 500", contracts: ["TURBOSLONG", "TURBOSSHORT"] },
  { tier: 6, title: "Stock Indices", adds: "US500, US Tech 100, Wall Street 30", contracts: [] },
  { tier: 7, title: "Vanilla Options", adds: "European calls/puts on volatility indices", contracts: ["VANILLALONGCALL", "VANILLALONGPUT"] },
  { tier: 8, title: "Higher/Lower + Touch/No Touch", adds: "Classic binaries with barriers", contracts: ["CALL", "PUT", "HIGHER", "LOWER", "ONETOUCH", "NOTOUCH", "ENDSBETWEEN", "ENDSOUTSIDE", "STAYSBETWEEN", "GOESOUTSIDE"] },
  { tier: 9, title: "Specialized Contracts", adds: "Digits, Asians, Reset, Tick Highlow, Step, Daily Reset", contracts: ["DIGITMATCH", "DIGITDIFF", "DIGITOVER", "DIGITUNDER", "DIGITEVEN", "DIGITODD", "ASIANU", "ASIAND", "RESETCALL", "RESETPUT", "TICKHIGH", "TICKLOW"] },
];

const UNLOCK_RULES = [
  "≥ 30 days at the current tier",
  "≥ 50 trades at the current tier",
  "Sharpe ≥ 1.0 over those 50 trades",
  "Max drawdown < 60% of the per-Agent DD limit",
  "Risk disclosure acknowledged (Shona + English)",
  "WebAuthn confirm (Tiers 5+)",
];

export default function TiersPage() {
  const { activeCompanyId, companies, loading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [symbols, setSymbols] = useState<SymbolDef[]>([]);
  useEffect(() => {
    api.listSymbols().then((r) => setSymbols(r.symbols));
  }, []);

  // Symbol catalog grouped by tier — for the "you have N of M symbols
  // unlocked at this tier" hint.
  const symbolsByTier = useMemo(() => {
    const m = new Map<number, SymbolDef[]>();
    for (const s of symbols) {
      const list = m.get(s.tier) ?? [];
      list.push(s);
      m.set(s.tier, list);
    }
    return m;
  }, [symbols]);

  if (loading) {
    return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  }

  if (!active) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">
          Select or create a company to view its tier progression.
        </p>
        <Link
          href="/companies/new"
          className="inline-block rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg"
        >
          + Create a company
        </Link>
      </main>
    );
  }

  const current = active.current_asset_tier;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">
          {active.name} — Asset Tier Progression
        </h1>
        <p className="text-xs text-text-mute">
          Currently <span className="text-bull">Tier {current} of 9</span> ·{" "}
          {active.unlocked_contract_types.length} contract type
          {active.unlocked_contract_types.length === 1 ? "" : "s"} unlocked
        </p>
      </header>

      <div className="rounded-2xl border border-border bg-bg-card p-5 mb-6">
        <h2 className="mb-2 text-xs uppercase tracking-widest text-text-mute">
          To unlock the next tier
        </h2>
        <ul className="space-y-1 text-sm">
          {UNLOCK_RULES.map((r) => (
            <li key={r} className="flex items-baseline gap-2">
              <span className="text-bull">✓</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-mute">
          Phase 0 dev — paper-trading bypasses these gates. Live unlocks
          require the gates to actually pass per PLAN §8.
        </p>
      </div>

      <ol className="space-y-3">
        {TIERS.map((t) => {
          const state =
            t.tier < current
              ? "active"
              : t.tier === current
                ? "current"
                : t.tier === current + 1
                  ? "eligible"
                  : "locked";
          const syms = symbolsByTier.get(t.tier) ?? [];
          return (
            <li
              key={t.tier}
              className={`rounded-2xl border p-5 transition ${
                state === "current"
                  ? "border-bull bg-bull-soft"
                  : state === "active"
                    ? "border-border bg-bg-card"
                    : state === "eligible"
                      ? "border-warning/40 bg-bg-card"
                      : "border-border bg-bg-elev-1 opacity-60"
              }`}
            >
              <div className="mb-2 flex items-baseline justify-between">
                <div className="flex items-baseline gap-3">
                  <span className="num text-xs uppercase tracking-widest text-text-mute">
                    Tier {t.tier}
                  </span>
                  <h3 className="text-base font-medium">{t.title}</h3>
                </div>
                <StatusBadge state={state} />
              </div>
              <p className="text-sm text-text-dim">
                <span className="text-text-mute">Adds:</span> {t.adds}
              </p>
              {t.contracts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {t.contracts.map((c) => (
                    <span
                      key={c}
                      className="num rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] tracking-wider text-text-dim"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}
              {syms.length > 0 && (
                <div className="mt-2 text-xs text-text-mute">
                  Catalog symbols at this tier: {syms.map((s) => s.display).join(", ")}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </main>
  );
}

function StatusBadge({
  state,
}: {
  state: "active" | "current" | "eligible" | "locked";
}) {
  const map: Record<typeof state, { label: string; cls: string }> = {
    active: { label: "✅ unlocked", cls: "text-bull" },
    current: { label: "● current", cls: "text-bull" },
    eligible: { label: "🔓 eligible", cls: "text-warning" },
    locked: { label: "🔒 locked", cls: "text-text-mute" },
  };
  const { label, cls } = map[state];
  return <span className={`text-[10px] uppercase tracking-widest ${cls}`}>{label}</span>;
}
