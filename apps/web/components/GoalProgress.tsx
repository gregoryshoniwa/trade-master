"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, type CompanyGoals } from "@/lib/api";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

type Props = {
  companyId: string;
  /** Optional override — page passes its already-fetched PnL to avoid a
   *  duplicate roundtrip. When omitted, the component fetches today's
   *  closed intents itself (used by the TopBar mount, which has no
   *  intents context of its own). */
  todayRealizedUsd?: number;
  /** Compact inline mode used in the fullscreen dashboard header. Renders
   *  as one row (label · bar · amount) instead of a tile, and stays
   *  invisible when there's no target so the header doesn't grow. */
  compact?: boolean;
};

/** Dashboard strip showing daily-target progress.
 *
 * Hidden when no target is set — surfacing an empty bar is just noise.
 * Color and label change as the throttle band approaches so the CEO
 * sees at a glance how the decision loop is currently sizing trades. */
export default function GoalProgress({ companyId, todayRealizedUsd, compact = false }: Props) {
  const [goals, setGoals] = useState<CompanyGoals | null>(null);
  const [selfPnl, setSelfPnl] = useState<number | null>(null);

  useEffect(() => {
    api.getCompanyGoals(companyId).then(setGoals).catch(() => setGoals(null));
  }, [companyId]);

  // Self-fetch path: TopBar uses this without an intents context. We
  // refresh on the same 30s cadence as the dashboard's poll. When the
  // parent already passes a PnL, this fetch never runs.
  useEffect(() => {
    if (todayRealizedUsd !== undefined) return;
    let cancelled = false;
    async function load() {
      try {
        const r = await api.listIntents(companyId, "all", 100);
        if (cancelled) return;
        const today = new Date().toISOString().slice(0, 10);
        const total = r.intents
          .filter((i) => i.closed_at != null && i.closed_at.startsWith(today))
          .reduce((s, i) => s + (i.realized_pnl_usd ?? 0), 0);
        setSelfPnl(total);
      } catch { /* silent — bar just stays at 0 */ }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [companyId, todayRealizedUsd]);

  const effectivePnl = todayRealizedUsd ?? selfPnl ?? 0;

  if (!goals || goals.daily_profit_target_usd == null) {
    // No target set. In compact mode collapse entirely so the header
    // doesn't grow; the verbose discovery hint stays for the legacy
    // wide layout.
    if (compact) return null;
    if (goals == null) return null;
    return (
      <div className="mb-4 rounded-2xl border border-border bg-bg-card p-3 text-xs text-text-mute">
        No daily profit target set.{" "}
        <Link href="/settings" className="text-accent hover:underline">
          Set one in Settings
        </Link>{" "}
        and the manager will read it on every review; the decision loop will throttle stakes as you approach it.
      </div>
    );
  }

  const target = goals.daily_profit_target_usd;
  const pnl = effectivePnl;
  // Progress can go negative if the day is in the red — clamp the bar
  // at 0 but keep the label honest.
  const rawProgress = target > 0 ? pnl / target : 0;
  const progress = Math.max(0, Math.min(1.5, rawProgress));

  const band =
    rawProgress >= 1.0 ? "hit"
    : rawProgress >= 0.8 ? "halve"
    : rawProgress >= 0.5 ? "trim"
    : rawProgress < 0 ? "red"
    : "normal";

  const bandLabel = {
    hit:   "Target hit — new trades skipped",
    halve: "≥ 80% of target — stakes halved",
    trim:  "≥ 50% of target — stakes at 75%",
    normal: "Sizing normally",
    red:   "Down on the day",
  }[band];

  const barClass = {
    hit:    "bg-bull",
    halve:  "bg-amber-400",
    trim:   "bg-accent",
    normal: "bg-accent",
    red:    "bg-bear",
  }[band];

  const labelClass = {
    hit:    "text-bull",
    halve:  "text-amber-400",
    trim:   "text-accent",
    normal: "text-text-mute",
    red:    "text-bear",
  }[band];

  // Compact mode: one row, mini bar, no card chrome. Designed for the
  // top strip on the fullscreen dashboard.
  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-3" title={bandLabel}>
        <span className="shrink-0 text-[10px] uppercase tracking-widest text-text-mute">
          Goal
        </span>
        <div className="relative h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-bg-elev-2">
          <div
            className={`h-full transition-all ${barClass}`}
            style={{ width: `${Math.min(100, Math.max(0, rawProgress * 100))}%` }}
          />
          {rawProgress > 1 && (
            <div
              className="absolute right-0 top-0 h-full bg-bull/30"
              style={{ width: `${Math.min(50, (rawProgress - 1) * 100)}%` }}
            />
          )}
        </div>
        <div className="shrink-0 whitespace-nowrap text-[11px]">
          <span className={`num ${pnl > 0 ? "text-bull" : pnl < 0 ? "text-bear" : "text-text"}`}>
            {pnl >= 0 ? "+" : ""}{FMT_USD.format(pnl)}
          </span>
          <span className="text-text-mute"> / </span>
          <span className="num">{FMT_USD.format(target)}</span>
          <span className={`ml-1 num ${labelClass}`}>({(rawProgress * 100).toFixed(0)}%)</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-border bg-bg-card p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-widest text-text-mute">
            Daily profit target
          </span>
          <span className={`text-xs ${labelClass}`}>· {bandLabel}</span>
        </div>
        <div className="text-sm">
          <span className={`num ${pnl > 0 ? "text-bull" : pnl < 0 ? "text-bear" : "text-text"}`}>
            {pnl >= 0 ? "+" : ""}{FMT_USD.format(pnl)}
          </span>
          <span className="text-text-mute"> / </span>
          <span className="num">{FMT_USD.format(target)}</span>
          <span className="ml-2 text-xs text-text-mute num">
            ({(rawProgress * 100).toFixed(0)}%)
          </span>
        </div>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-elev-2">
        <div
          className={`h-full transition-all ${barClass}`}
          style={{ width: `${Math.min(100, Math.max(0, rawProgress * 100))}%` }}
        />
        {rawProgress > 1 && (
          <div
            className="absolute right-0 top-0 h-full bg-bull/30"
            style={{ width: `${Math.min(50, (rawProgress - 1) * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}
