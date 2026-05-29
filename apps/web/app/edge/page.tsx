"use client";

/**
 * Edge report — a plain-English read on whether each agent actually
 * has an edge in live trading, and whether they match the backtest
 * that was used to size them in the first place. Everything here is
 * derived: postmortems + intents + most-recent finished backtest.
 *
 * If the live hit-rate trails the backtest by >3pp on ≥10 trades, the
 * row goes red ("underperforming vs backtest") — that's the signal the
 * agent's in-sample edge didn't survive contact with real fills.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type EdgeReport, type EdgeWindow } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const FMT_PCT = (x: number | null) => x == null ? "—" : `${(x * 100).toFixed(1)}%`;

const WINDOWS: { v: EdgeWindow; label: string }[] = [
  { v: "7d", label: "7d" },
  { v: "30d", label: "30d" },
  { v: "90d", label: "90d" },
  { v: "all", label: "All time" },
];

export default function EdgePage() {
  const { me, companies, activeCompanyId, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;
  const [window, setWindow] = useState<EdgeWindow>("30d");
  const [report, setReport] = useState<EdgeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true); setError(null);
    try {
      setReport(await api.getEdgeReport(activeCompanyId, window));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, window]);

  useEffect(() => { refresh(); }, [refresh]);

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <Link href="/login" className="text-bull">Sign in</Link>
      </main>
    );
  }
  if (!active) {
    return <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">Select or create a company first.</main>;
  }

  const settled = report?.agents.reduce((s, a) => s + a.live_n, 0) ?? 0;
  const totalPnl = report?.agents.reduce((s, a) => s + a.live_total_pnl_usd, 0) ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {active.name} — Edge report
          </h1>
          <p className="text-xs text-text-mute">
            Live performance per agent versus their backtest — the honest answer to "is this thing actually working?".
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border bg-bg-elev-1 p-1 text-xs">
            {WINDOWS.map((o) => (
              <button
                key={o.v} type="button" onClick={() => setWindow(o.v)}
                className={`rounded px-2 py-1 transition ${
                  window === o.v ? "bg-accent text-white" : "text-text-mute hover:text-text"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button
            type="button" onClick={refresh}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-bull/40 hover:text-text"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      <section className="mb-6 grid grid-cols-3 gap-3">
        <Tile label="Settled trades" value={String(settled)} />
        <Tile
          label="Net realized P&L"
          value={FMT_USD.format(totalPnl)}
          tone={totalPnl > 0 ? "bull" : totalPnl < 0 ? "bear" : "muted"}
        />
        <Tile
          label="Agents reporting edge"
          value={String(report?.agents.filter((a) => a.verdict_tone === "bull").length ?? 0)}
        />
      </section>

      <section className="rounded-2xl border border-border bg-bg-card">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-text-mute">
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left">Agent</th>
              <th className="px-4 py-3 text-right">Trades</th>
              <th className="px-4 py-3 text-right">Hit-rate</th>
              <th className="px-4 py-3 text-right">Avg P&L</th>
              <th className="px-4 py-3 text-right">Total P&L</th>
              <th className="px-4 py-3 text-right">Backtest hit</th>
              <th className="px-4 py-3 text-right">Gap (pp)</th>
              <th className="px-4 py-3 text-right">Calibration</th>
              <th className="px-4 py-3 text-left">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {report?.agents.map((a) => {
              const toneCls = a.verdict_tone === "bull" ? "text-bull"
                : a.verdict_tone === "bear" ? "text-bear" : "text-text-mute";
              return (
                <tr key={a.agent_id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{a.agent_name}</span>
                      {a.is_paused && <span className="rounded bg-bear-soft px-1.5 py-0.5 text-[9px] text-bear">paused</span>}
                      {!a.is_active && <span className="rounded bg-bg-elev-2 px-1.5 py-0.5 text-[9px] text-text-mute">inactive</span>}
                    </div>
                    <div className="num text-[10px] text-text-mute">{a.forecasting_model}</div>
                  </td>
                  <td className="num px-4 py-3 text-right">
                    {a.live_n}{" "}
                    <span className="text-[10px] text-text-mute">
                      ({a.live_wins}W / {a.live_losses}L)
                    </span>
                  </td>
                  <td className={`num px-4 py-3 text-right ${
                    a.live_hit_rate == null ? "" :
                    a.live_hit_rate >= 0.52 ? "text-bull" :
                    a.live_hit_rate <= 0.48 ? "text-bear" : ""
                  }`}>
                    {FMT_PCT(a.live_hit_rate)}
                  </td>
                  <td className="num px-4 py-3 text-right">
                    {a.live_avg_pnl_usd == null ? "—" : FMT_USD.format(a.live_avg_pnl_usd)}
                  </td>
                  <td className={`num px-4 py-3 text-right ${
                    a.live_total_pnl_usd > 0 ? "text-bull" :
                    a.live_total_pnl_usd < 0 ? "text-bear" : ""
                  }`}>
                    {FMT_USD.format(a.live_total_pnl_usd)}
                  </td>
                  <td className="num px-4 py-3 text-right text-text-dim">
                    {a.backtest_hit_rate == null
                      ? <span className="text-[10px]">no run</span>
                      : (
                        <Link
                          href={`/backtests/${a.backtest_run_id}`}
                          className="hover:text-accent"
                        >
                          {FMT_PCT(a.backtest_hit_rate)}
                        </Link>
                      )
                    }
                  </td>
                  <td className={`num px-4 py-3 text-right ${
                    a.hit_rate_gap_pp == null ? "" :
                    a.hit_rate_gap_pp >= 0 ? "text-bull" : "text-bear"
                  }`}>
                    {a.hit_rate_gap_pp == null ? "—" :
                      `${a.hit_rate_gap_pp >= 0 ? "+" : ""}${a.hit_rate_gap_pp.toFixed(1)}`
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    <CalibrationCell a={a} />
                  </td>
                  <td className={`px-4 py-3 text-xs ${toneCls}`}>{a.verdict}</td>
                </tr>
              );
            })}
            {report?.agents.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-text-mute">
                  No agents found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="mt-4 text-[10px] text-text-mute">
        Verdict thresholds: <span className="text-bull">real edge</span> = ≥10 trades, hit-rate ≥ 55% and P&L positive ·{" "}
        <span className="text-bear">underperforming vs backtest</span> = live hit-rate trails the backtest by &gt;3pp ·{" "}
        <span className="text-bear">inverse</span> = hit-rate &lt; 48% ·{" "}
        otherwise <span className="text-text-mute">noise</span>.
      </p>
      <p className="mt-1 text-[10px] text-text-mute">
        Calibration column shows the Brier-score change after the model's
        active calibrator is applied. ISO = isotonic (PAV, needs ≥ 80 samples) ·
        PLATT = logistic scaling (works from 20 samples). <span className="text-bull">↓</span> means the calibrator reduces prediction error;
        a small change means the raw confidence was already well-calibrated.
      </p>
    </main>
  );
}

function CalibrationCell({ a }: { a: import("@/lib/api").AgentEdge }) {
  if (!a.calibration_method || a.calibration_brier_raw == null || a.calibration_brier_calibrated == null) {
    return (
      <span className="text-[10px] text-text-mute" title={`Calibrator needs ≥ 20 settled trades. ${a.calibration_n_samples ?? 0} so far.`}>
        not yet
      </span>
    );
  }
  // Brier is "lower is better", so a positive delta means calibration
  // reduces prediction error — show as a green ↓.
  const improvement = a.calibration_brier_raw - a.calibration_brier_calibrated;
  const noChange = Math.abs(improvement) < 0.001;
  const cls = noChange ? "text-text-mute" : improvement > 0 ? "text-bull" : "text-bear";
  const arrow = noChange ? "" : improvement > 0 ? "↓" : "↑";
  const tag = a.calibration_method === "platt" ? "PLATT" : "ISO";
  const tip =
    `${a.calibration_method} fit on ${a.calibration_n_samples} settled trades. ` +
    `Brier ${a.calibration_brier_raw.toFixed(3)} → ${a.calibration_brier_calibrated.toFixed(3)} ` +
    `(ECE ${a.calibration_ece_raw?.toFixed(3)} → ${a.calibration_ece_calibrated?.toFixed(3)}).`;
  return (
    <span className="inline-flex items-center gap-1 text-xs" title={tip}>
      <span className="rounded-full bg-bg-elev-2 px-1.5 py-0.5 text-[9px] tracking-widest text-text-mute">
        {tag}
      </span>
      <span className={`num ${cls}`}>
        {arrow}{Math.abs(improvement).toFixed(3)}
      </span>
    </span>
  );
}

function Tile({ label, value, tone = "muted" }: { label: string; value: string; tone?: "bull" | "bear" | "muted" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-text";
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 text-lg font-medium ${cls}`}>{value}</div>
    </div>
  );
}
