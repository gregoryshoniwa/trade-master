"use client";

/**
 * Dashboard sidebar panel: lets the CEO place a manual trade on the
 * current symbol without going through the agent decision loop.
 *
 *   ▲ Buy UP  (bull)       ▼ Sell DOWN  (bear)
 *   Stake: [ ____ ] USD    Duration: [ __ ] s
 *   [ Place trade ]
 *
 * Submits to /api/v1/companies/{cid}/trades/quick which:
 *  - creates a trade_intent attributed to the company's manager agent
 *  - tags entry_context with sizing.method="ceo_manual"
 *  - skips the approval queue (auto_approved)
 *  - publishes straight to the gateway
 *
 * Below the form: recent CEO trades the dashboard has placed (last 5).
 */

import { useEffect, useState } from "react";

import { api, ApiError, type QuickTradeResult } from "@/lib/api";

const FMT_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

const STAKE_KEY = "tm.ceo.stake";
const DURATION_KEY = "tm.ceo.duration";

type Props = {
  companyId: string;
  symbol: string;
  symbolDisplay: string;
  /** Called after a successful trade so the dashboard can refresh its
   *  intents list. */
  onPlaced?: () => void;
};

export default function CEOTradePanel({ companyId, symbol, symbolDisplay, onPlaced }: Props) {
  const [stake, setStake] = useState<string>("10");
  const [duration, setDuration] = useState<string>("60");
  const [busy, setBusy] = useState<null | "up" | "down">(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<QuickTradeResult[]>([]);

  // Restore last-used stake + duration per device so a returning user
  // doesn't retype them every session.
  useEffect(() => {
    const s = localStorage.getItem(STAKE_KEY);
    const d = localStorage.getItem(DURATION_KEY);
    if (s) setStake(s);
    if (d) setDuration(d);
  }, []);

  async function place(direction: "up" | "down") {
    setError(null);
    const stakeNum = Number(stake);
    const durNum = Number(duration);
    if (!Number.isFinite(stakeNum) || stakeNum <= 0) {
      setError("Stake must be a positive number");
      return;
    }
    if (!Number.isFinite(durNum) || durNum < 15) {
      setError("Duration must be ≥ 15 seconds");
      return;
    }
    localStorage.setItem(STAKE_KEY, stake);
    localStorage.setItem(DURATION_KEY, duration);
    setBusy(direction);
    try {
      const result = await api.placeQuickTrade(companyId, {
        asset: symbol,
        direction,
        stake_usd: stakeNum,
        duration_secs: durNum,
        reason: "CEO trade from dashboard",
      });
      setRecent((prev) => [result, ...prev].slice(0, 5));
      onPlaced?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "trade failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-mute">
          CEO trades
        </span>
        <span className="num text-[11px] text-text-dim" title="Current chart symbol">
          {symbolDisplay}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => place("up")}
          className="rounded-md border border-bull/40 bg-bull-soft px-2 py-2 text-sm font-medium text-bull hover:bg-bull/20 disabled:opacity-50"
        >
          {busy === "up" ? "Placing…" : "▲ Buy UP"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => place("down")}
          className="rounded-md border border-bear/40 bg-bear-soft px-2 py-2 text-sm font-medium text-bear hover:bg-bear/20 disabled:opacity-50"
        >
          {busy === "down" ? "Placing…" : "▼ Sell DOWN"}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-text-mute">Stake (USD)</span>
          <input
            type="number" inputMode="decimal" min="1" step="1"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            className="num mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-sm focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-widest text-text-mute">Duration (s)</span>
          <input
            type="number" inputMode="numeric" min="15" step="15"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="num mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-sm focus:border-accent focus:outline-none"
          />
        </label>
      </div>

      {error && (
        <div className="mt-2 rounded-md border border-bear/40 bg-bear-soft p-2 text-[11px] text-bear">
          {error}
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <div className="mb-1 text-[10px] uppercase tracking-widest text-text-mute">
            Last placed
          </div>
          <ul className="space-y-1">
            {recent.map((r) => (
              <li
                key={r.intent_id}
                className={`flex items-center justify-between gap-2 text-[11px] ${
                  r.direction === "up" ? "text-bull" : "text-bear"
                }`}
              >
                <span className="num">
                  {r.direction === "up" ? "▲" : "▼"} {r.contract_type}
                </span>
                <span className="num text-text-dim">
                  ${r.stake_usd.toFixed(2)} · {r.duration_secs}s
                </span>
                <span className="num text-text-mute" title={r.intent_id}>
                  {FMT_TIME.format(new Date())}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
