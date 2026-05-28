"use client";

import { useEffect, useRef, useState } from "react";

import { api, type DerivBalance as DerivBalanceState } from "@/lib/api";

/** Live Deriv account balance in the top bar. Polls the api every 5s.
 *  Shows the delta since the page loaded, so you can watch P&L move in
 *  real time as trades settle. Hidden if the gateway hasn't authorized
 *  yet (DERIV_API_TOKEN unset or session not up). */
export default function DerivBalance() {
  const [state, setState] = useState<DerivBalanceState | null>(null);
  const baselineRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await api.getDerivBalance();
        if (cancelled) return;
        setState(r);
        if (r.available && baselineRef.current == null) baselineRef.current = r.balance;
      } catch {
        /* unauth on logout — fine to swallow */
      }
    }
    tick();
    const t = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!state || !state.available) return null;

  const fmtUsd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: state.currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const baseline = baselineRef.current;
  const delta = baseline != null ? state.balance - baseline : 0;
  const deltaTone = delta > 0.005 ? "text-bull" : delta < -0.005 ? "text-bear" : "text-text-mute";
  const deltaSign = delta > 0 ? "+" : "";

  return (
    <div
      className="hidden items-center gap-3 rounded-md border border-border bg-bg-elev-2 px-3 py-1.5 sm:flex"
      title={`Deriv ${state.is_virtual ? "demo" : "live"} account ${state.loginid ?? ""}`}
    >
      <span className="text-xs uppercase tracking-widest text-text-mute">
        {state.is_virtual ? "Demo" : "Live"}
      </span>
      <span className="num text-sm font-medium text-text">{fmtUsd.format(state.balance)}</span>
      {baseline != null && Math.abs(delta) > 0.005 && (
        <span className={`num text-xs ${deltaTone}`}>
          {deltaSign}{fmtUsd.format(delta)}
        </span>
      )}
    </div>
  );
}
