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
  todayRealizedUsd: number;
};

/** Dashboard strip showing daily-target progress.
 *
 * Hidden when no target is set — surfacing an empty bar is just noise.
 * Color and label change as the throttle band approaches so the CEO
 * sees at a glance how the decision loop is currently sizing trades. */
export default function GoalProgress({ companyId, todayRealizedUsd }: Props) {
  const [goals, setGoals] = useState<CompanyGoals | null>(null);

  useEffect(() => {
    api.getCompanyGoals(companyId).then(setGoals).catch(() => setGoals(null));
  }, [companyId]);

  if (!goals || goals.daily_profit_target_usd == null) {
    // No target set — render a thin promotional strip so the feature
    // is discoverable, but only once we know we don't have data.
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
  const pnl = todayRealizedUsd;
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
      {/* Bar canvas. We show two layers when overshoot: the 0-100% region
          fills normally, and any excess (>100%) tints the trailing 50%
          extension green to make a clean "you did it" visual. */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-bg-elev-2">
        <div
          className={`h-full transition-all ${barClass}`}
          style={{ width: `${Math.min(100, Math.max(0, rawProgress * 100))}%` }}
        />
        {rawProgress > 1 && (
          <div
            className="absolute right-0 top-0 h-full bg-bull/30"
            style={{
              width: `${Math.min(50, (rawProgress - 1) * 100)}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}
