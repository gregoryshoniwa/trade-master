"use client";

import { useCallback, useEffect, useState } from "react";

import { api, type SafetyState } from "@/lib/api";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Slim sibling to the kill switch: one chip showing the company's
 *  insurance pot (built up by the profit-sweep job — see app/sweep.py)
 *  and a chip for each agent currently cooling off after a loss streak.
 *  Both are passive surface area; no actions, no inputs. */
export default function SafetyBadges({ companyId }: { companyId: string }) {
  const [state, setState] = useState<SafetyState | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.getSafety(companyId));
    } catch {
      /* read failures are non-fatal */
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!state) return null;

  const insurance = state.insurance_balance_usd;
  const cooling = state.cooling_off_agents;

  if (insurance <= 0 && cooling.length === 0) return null;

  return (
    <div className="flex items-center gap-2 text-xs">
      {insurance > 0 && (
        <span
          title={
            state.recent_sweeps.length
              ? `Last sweep: ${state.recent_sweeps[0].reason}`
              : "Built up by the profit-sweep job"
          }
          className="num inline-flex items-center gap-1 rounded-md border border-bull/40 bg-bull-soft px-2 py-1 text-bull"
        >
          🏦 {FMT_USD.format(insurance)} insured
        </span>
      )}
      {cooling.map((a) => (
        <span
          key={a.agent_id}
          title={`${a.agent_name} is in a 30-min cool-down after a loss streak`}
          className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-bg-elev-2 px-2 py-1 text-warning"
        >
          ❄️ <span className="num">{a.agent_name}</span> cooling{" "}
          <Countdown until={a.cooling_off_until} />
        </span>
      ))}
    </div>
  );
}

function Countdown({ until }: { until: string }) {
  const [remaining, setRemaining] = useState(() => msUntil(until));
  useEffect(() => {
    const t = setInterval(() => setRemaining(msUntil(until)), 1_000);
    return () => clearInterval(t);
  }, [until]);
  if (remaining <= 0) return <span className="num">0s</span>;
  const m = Math.floor(remaining / 60_000);
  const s = Math.floor((remaining % 60_000) / 1_000);
  return (
    <span className="num">
      {m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`}
    </span>
  );
}

function msUntil(iso: string): number {
  return Math.max(0, new Date(iso).getTime() - Date.now());
}
