"use client";

/**
 * One backtest run — full per-symbol breakdown plus the "apply to agent"
 * form. The apply action is what wires the result back into the live
 * decision pipeline: bumping an agent's `min_confidence_threshold` to the
 * floor where hit-rate cleared 53%, and/or pruning symbols where the model
 * was worse than coin-flip from the agent's `allowed_assets`.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  ApiError,
  type Agent,
  type BacktestPerSymbol,
  type BacktestRun,
  type BacktestSummary,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { friendlySymbol } from "@/lib/symbols";

const FMT_PCT = (x: number | null | undefined) =>
  x == null ? "—" : `${(x * 100).toFixed(1)}%`;
const FMT_NUM = new Intl.NumberFormat("en-US");

export default function BacktestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me, companies, activeCompanyId, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [run, setRun] = useState<BacktestRun | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Apply form
  const [agentId, setAgentId] = useState<string>("");
  const [setMinConf, setSetMinConf] = useState(true);
  const [pruneSymbols, setPruneSymbols] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeCompanyId || !id) return;
    try {
      const r = await api.getBacktest(activeCompanyId, id);
      setRun(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    }
  }, [activeCompanyId, id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while the run isn't terminal.
  useEffect(() => {
    if (!run || (run.status !== "pending" && run.status !== "running")) return;
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [run, refresh]);

  useEffect(() => {
    if (!activeCompanyId) return;
    api.listAgents(activeCompanyId).then((r) => setAgents(r.agents)).catch(() => { /* ignore */ });
  }, [activeCompanyId]);

  // Match the form's default agent to the first one consuming this model.
  useEffect(() => {
    if (!run || agentId) return;
    const match = agents.find((a) => a.forecasting_model === run.model_key);
    if (match) setAgentId(match.id);
  }, [agents, run, agentId]);

  const eligibleAgents = useMemo(
    () => (run ? agents.filter((a) => a.forecasting_model === run.model_key) : []),
    [agents, run],
  );

  async function onApply(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId || !run || !agentId) return;
    setApplying(true);
    setError(null);
    setApplySuccess(null);
    try {
      const r = await api.applyBacktest(activeCompanyId, run.id, {
        agent_id: agentId,
        set_min_confidence: setMinConf,
        prune_weak_symbols: pruneSymbols,
      });
      setApplySuccess(`Applied to agent — ${Object.keys(r.changes).join(", ")}`);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "apply failed");
    } finally {
      setApplying(false);
    }
  }

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me || !active) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">
        <Link href="/backtests" className="text-bull underline">← Back to backtests</Link>
      </main>
    );
  }
  if (!run) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 text-sm text-text-mute">
        <Link href="/backtests" className="text-bull">← Back</Link>
        <div className="mt-4">Loading run…</div>
        {error && <div className="mt-2 text-bear">{error}</div>}
      </main>
    );
  }

  const result = run.result_json;
  const summary: BacktestSummary | null = result?.summary ?? null;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-4">
        <Link href="/backtests" className="text-xs text-text-mute hover:text-text">
          ← All backtests
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight">
          {run.model_key} · {run.symbols.length} symbol(s) · {run.status}
        </h1>
        <p className="text-xs text-text-mute">
          {new Date(run.created_at).toLocaleString("en-GB", { hour12: false })}
          {run.duration_secs != null && <> · ran for {run.duration_secs}s</>}
        </p>
      </header>

      {run.error_message && (
        <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
          {run.error_message}
        </div>
      )}

      {(run.status === "pending" || run.status === "running") && (
        <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm">
          Backtest is {run.status}. This page auto-refreshes every 5 seconds.
          Kronos runs typically take 10–40 minutes on CPU.
        </div>
      )}

      {summary && (
        <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Forecasts" value={FMT_NUM.format(summary.n_forecasts ?? 0)} />
          <Tile
            label="Hit-rate"
            value={FMT_PCT(summary.overall_hit_rate)}
            tone={
              summary.overall_hit_rate == null ? "muted"
              : summary.overall_hit_rate >= 0.52 ? "bull"
              : summary.overall_hit_rate <= 0.48 ? "bear" : "muted"
            }
          />
          <Tile
            label="Brier"
            value={summary.overall_brier == null ? "—" : summary.overall_brier.toFixed(3)}
            hint="lower = better calibration"
          />
          <Tile
            label="Sim P&L"
            value={summary.overall_pnl_pct == null ? "—" : `${summary.overall_pnl_pct.toFixed(2)}%`}
            tone={
              summary.overall_pnl_pct == null ? "muted"
              : summary.overall_pnl_pct > 0 ? "bull"
              : summary.overall_pnl_pct < 0 ? "bear" : "muted"
            }
          />
        </section>
      )}

      {summary && summary.by_floor && summary.by_floor.length > 0 && (
        <section className="mb-6 rounded-2xl border border-border bg-bg-card p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-text-mute">
            Hit-rate by confidence floor
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-text-mute">
                <th className="pb-2">Floor</th>
                <th className="pb-2 text-right">Signals</th>
                <th className="pb-2 text-right">Hit-rate</th>
                <th className="pb-2 text-right">Sim P&L</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {summary.by_floor.map((b) => {
                const isBest = summary.best_floor?.floor === b.floor;
                return (
                  <tr key={b.floor} className={`border-t border-border ${isBest ? "bg-bull-soft" : ""}`}>
                    <td className="num py-1.5">≥ {b.floor.toFixed(2)}</td>
                    <td className="num py-1.5 text-right text-text-dim">{FMT_NUM.format(b.n)}</td>
                    <td className={`num py-1.5 text-right ${b.hit >= 0.52 ? "text-bull" : b.hit <= 0.48 ? "text-bear" : ""}`}>
                      {FMT_PCT(b.hit)}
                    </td>
                    <td className={`num py-1.5 text-right ${b.pnl >= 0 ? "text-bull" : "text-bear"}`}>
                      {(b.pnl * 100).toFixed(2)}%
                    </td>
                    <td className="py-1.5 pl-2 text-[10px] text-bull">
                      {isBest && "← recommend"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!summary.best_floor && (
            <p className="mt-2 text-xs text-text-mute">
              No floor cleared 53% hit-rate with ≥100 signals — model doesn't show clear edge on this dataset.
            </p>
          )}
        </section>
      )}

      {summary && (
        <section className="mb-6 rounded-2xl border border-border bg-bg-card p-4">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-text-mute">
            Apply to an agent
          </h2>
          {eligibleAgents.length === 0 ? (
            <p className="text-xs text-text-mute">
              No agents currently use <span className="num">{run.model_key}</span>.
              Configure one on the Agents page first.
            </p>
          ) : (
            <form onSubmit={onApply} className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-widest text-text-mute">Agent</span>
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="rounded-md border border-border bg-bg-elev-1 px-2 py-2 text-sm outline-none focus:border-accent"
                >
                  {eligibleAgents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · floor {(a.min_confidence_threshold ?? 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>

              <div className="md:row-span-2 space-y-2 text-xs">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={setMinConf}
                    onChange={(e) => setSetMinConf(e.target.checked)}
                    disabled={!summary.best_floor}
                    className="mt-0.5"
                  />
                  <span>
                    Set <span className="num">min_confidence_threshold</span> to{" "}
                    <span className="num text-text">
                      {summary.best_floor ? summary.best_floor.floor.toFixed(2) : "—"}
                    </span>
                    {summary.best_floor && (
                      <span className="text-text-mute">
                        {" "}({FMT_PCT(summary.best_floor.hit)} on {FMT_NUM.format(summary.best_floor.n)} signals)
                      </span>
                    )}
                  </span>
                </label>

                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={pruneSymbols}
                    onChange={(e) => setPruneSymbols(e.target.checked)}
                    disabled={!summary.weak_symbols.length}
                    className="mt-0.5"
                  />
                  <span>
                    Remove weak symbols from <span className="num">allowed_assets</span>:{" "}
                    {summary.weak_symbols.length
                      ? summary.weak_symbols.map(friendlySymbol).join(", ")
                      : "(no clearly-weak symbols)"}
                  </span>
                </label>
              </div>

              <div className="md:col-span-2 flex items-center justify-end">
                <button
                  type="submit"
                  disabled={applying || (!setMinConf && !pruneSymbols)}
                  className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
                >
                  {applying ? "Applying…" : "Apply"}
                </button>
              </div>
            </form>
          )}

          {applySuccess && (
            <div className="mt-3 rounded-md border border-bull/30 bg-bull-soft p-2 text-xs text-bull">
              {applySuccess}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-md border border-bear/40 bg-bear-soft p-2 text-xs text-bear">
              {error}
            </div>
          )}
        </section>
      )}

      {run.applied_actions.length > 0 && (
        <section className="mb-6 rounded-2xl border border-border bg-bg-card p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-text-mute">
            Applied changes
          </h2>
          <ul className="space-y-2 text-xs">
            {run.applied_actions.map((a, i) => (
              <li key={i} className="rounded-md bg-bg-elev-1 p-2">
                <div className="num text-text-dim">{a.agent_name}</div>
                <pre className="num mt-1 overflow-x-auto text-[10px] text-text-dim">
                  {JSON.stringify(a.changes, null, 2)}
                </pre>
                <div className="mt-1 text-[10px] text-text-mute">
                  {new Date(a.at).toLocaleString("en-GB", { hour12: false })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result?.per_symbol && (
        <section className="rounded-2xl border border-border bg-bg-card p-4">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-text-mute">
            Per-symbol breakdown
          </h2>
          <ul className="space-y-3">
            {result.per_symbol.map((s) => (
              <PerSymbolCard key={s.symbol} s={s} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function PerSymbolCard({ s }: { s: BacktestPerSymbol }) {
  if (s.error) {
    return (
      <li className="rounded-md border border-bear/30 bg-bear-soft p-3 text-xs">
        <span className="num">{friendlySymbol(s.symbol)}</span>: {s.error}
      </li>
    );
  }
  return (
    <li className="rounded-md bg-bg-elev-1 p-3 text-xs">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-medium text-text">{friendlySymbol(s.symbol)}</span>
        <span className="num text-text-dim">{s.symbol}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KV k="signals" v={FMT_NUM.format(s.n ?? 0)} />
        <KV
          k="hit"
          v={FMT_PCT(s.hit)}
          tone={s.hit == null ? "muted" : s.hit >= 0.52 ? "bull" : s.hit <= 0.48 ? "bear" : "muted"}
        />
        <KV k="brier" v={s.brier == null ? "—" : s.brier.toFixed(3)} />
        <KV
          k="sim P&L"
          v={s.total_pnl_pct == null ? "—" : `${s.total_pnl_pct.toFixed(2)}%`}
          tone={
            s.total_pnl_pct == null ? "muted"
            : s.total_pnl_pct > 0 ? "bull"
            : s.total_pnl_pct < 0 ? "bear" : "muted"
          }
        />
        <KV k="PF" v={s.profit_factor == null ? "—" : s.profit_factor.toFixed(2)} />
      </div>
    </li>
  );
}

function KV({ k, v, tone = "muted" }: { k: string; v: string; tone?: "bull" | "bear" | "muted" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-text";
  return (
    <div>
      <div className="text-[9px] uppercase tracking-widest text-text-mute">{k}</div>
      <div className={`num ${cls}`}>{v}</div>
    </div>
  );
}

function Tile({ label, value, tone = "muted", hint }: { label: string; value: string; tone?: "bull" | "bear" | "muted"; hint?: string }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-text";
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 text-lg ${cls}`}>{value}</div>
      {hint && <div className="text-[10px] text-text-mute">{hint}</div>}
    </div>
  );
}
