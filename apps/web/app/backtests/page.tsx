"use client";

/**
 * Backtests page — start a walk-forward eval, list past runs.
 *
 * The form is intentionally small: most users will pick a model + a handful
 * of symbols and hit Run. The Kronos build is slow on CPU (minutes to tens
 * of minutes), so we surface that explicitly and let the row poll itself
 * to "done" instead of blocking the form.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  ApiError,
  type BacktestRun,
  type ForecastModelDef,
  type SymbolDef,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { friendlySymbol } from "@/lib/symbols";

const DEFAULT_SYMBOLS = "frxEURUSD,frxGBPUSD,frxXAUUSD,cryBTCUSD,cryETHUSD";
const FMT_PCT = (x: number | null | undefined) =>
  x == null ? "—" : `${(x * 100).toFixed(1)}%`;
const FMT_NUM = new Intl.NumberFormat("en-US");

export default function BacktestsPage() {
  const { me, companies, activeCompanyId, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [models, setModels] = useState<ForecastModelDef[]>([]);
  const [symbols, setSymbols] = useState<SymbolDef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form state
  const [modelKey, setModelKey] = useState<string>("");
  const [symbolsCsv, setSymbolsCsv] = useState<string>(DEFAULT_SYMBOLS);
  const [granularity, setGranularity] = useState(60);
  const [barCount, setBarCount] = useState(5000);
  const [horizon, setHorizon] = useState(60);
  const [stride, setStride] = useState(3);
  const [stopPct, setStopPct] = useState(0.5); // shown as %
  const [payoff, setPayoff] = useState(1.5);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const r = await api.listBacktests(activeCompanyId, 50);
      setRuns(r.runs);
    } catch (e) {
      // Refresh failures shouldn't blow away the page on transient errors.
      if (e instanceof ApiError && e.status === 401) setError(e.message);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while anything is running so the user sees the row finish.
  useEffect(() => {
    const live = runs.some((r) => r.status === "pending" || r.status === "running");
    if (!live) return;
    const t = setInterval(refresh, 5_000);
    return () => clearInterval(t);
  }, [runs, refresh]);

  // Load model catalog + symbol list once.
  useEffect(() => {
    api.listForecastingModels().then((r) => {
      setModels(r.models);
      // Default to the first model — usually TTM since it sorts first.
      if (!modelKey && r.models.length > 0) setModelKey(r.models[0].key);
    }).catch(() => { /* leave empty */ });
    api.listSymbols().then((r) => setSymbols(r.symbols)).catch(() => { /* leave empty */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const knownSymbols = useMemo(
    () => new Set(symbols.map((s) => s.code)),
    [symbols],
  );

  const selectedModel = models.find((m) => m.key === modelKey);
  // The horizon ceiling IS the model's prediction_length — anything past
  // that the model can't forecast. TTM is 96, Kronos is 12. The form used
  // to default to 60 regardless, which 422'd against Kronos's validator
  // (max 24). Snap on every model change so the user can never submit an
  // out-of-range value.
  const horizonMax = selectedModel?.prediction_length ?? 60;
  useEffect(() => {
    if (!selectedModel) return;
    // Pick something reasonable: the smaller of the current value and the
    // model's max. If we're snapping down on a model switch, pick the
    // ceiling so the user sees the longest horizon this model supports.
    setHorizon((h) => (h > horizonMax ? horizonMax : h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, horizonMax]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCompanyId) return;
    setError(null);
    setBusy(true);
    try {
      const cleaned = symbolsCsv
        .split(",").map((s) => s.trim()).filter(Boolean);
      const unknown = cleaned.filter((s) => knownSymbols.size > 0 && !knownSymbols.has(s));
      if (unknown.length) {
        throw new ApiError(400, null, `unknown symbols: ${unknown.join(", ")}`);
      }
      const run = await api.createBacktest(activeCompanyId, {
        model_key: modelKey,
        symbols: cleaned,
        granularity_secs: granularity,
        bar_count: barCount,
        horizon,
        stride,
        stop_pct: stopPct / 100,
        payoff_ratio: payoff,
      });
      setRuns((prev) => [run, ...prev]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "start failed");
    } finally {
      setBusy(false);
    }
  }

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to run backtests.</p>
        <Link href="/login" className="rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg">Sign in</Link>
      </main>
    );
  }
  if (!active) {
    return <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">Select or create a company first.</main>;
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-lg font-semibold tracking-tight">
          {active.name} — Backtests
        </h1>
        <p className="text-xs text-text-mute">
          Walk-forward evaluate a forecasting model against real Deriv history,
          then apply the recommendation to a live agent.
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-border bg-bg-card p-4">
        <div className="mb-3 text-xs uppercase tracking-widest text-text-mute">
          New backtest
        </div>
        <form onSubmit={onSubmit} className="grid gap-3 md:grid-cols-2">
          <Field label="Model">
            <select
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              className={inputCls}
            >
              {models.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label} · {m.params}
                </option>
              ))}
            </select>
            {selectedModel && (
              <p className="mt-1 text-[10px] leading-snug text-text-mute">
                {selectedModel.description}
              </p>
            )}
          </Field>

          <Field label="Symbols (comma-separated)">
            <input
              value={symbolsCsv}
              onChange={(e) => setSymbolsCsv(e.target.value)}
              className={inputCls}
              placeholder={DEFAULT_SYMBOLS}
            />
          </Field>

          <Field label="Granularity (seconds per bar)">
            <input
              type="number" min={30} max={86400}
              value={granularity}
              onChange={(e) => setGranularity(Number(e.target.value))}
              className={inputCls}
            />
          </Field>

          <Field label="Bars fetched (≤ 5000)">
            <input
              type="number" min={200} max={5000}
              value={barCount}
              onChange={(e) => setBarCount(Number(e.target.value))}
              className={inputCls}
            />
          </Field>

          <Field label={`Horizon (bars ahead to score, max ${horizonMax})`}>
            <input
              type="number" min={1} max={horizonMax}
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className={inputCls}
            />
            {selectedModel && (
              <p className="mt-1 text-[10px] text-text-mute">
                {selectedModel.label} forecasts {selectedModel.prediction_length} bars ahead;
                horizon must be ≤ that.
              </p>
            )}
          </Field>

          <Field label="Stride (evaluate every N-th window)">
            <input
              type="number" min={1} max={50}
              value={stride}
              onChange={(e) => setStride(Number(e.target.value))}
              className={inputCls}
            />
          </Field>

          <Field label="Stop loss (% of price)">
            <input
              type="number" step="0.01" min={0.01} max={10}
              value={stopPct}
              onChange={(e) => setStopPct(Number(e.target.value))}
              className={inputCls}
            />
          </Field>

          <Field label="Payoff ratio (target / stop)">
            <input
              type="number" step="0.1" min={1} max={10}
              value={payoff}
              onChange={(e) => setPayoff(Number(e.target.value))}
              className={inputCls}
            />
          </Field>

          <div className="md:col-span-2 flex items-center justify-between gap-2">
            <p className="text-[10px] text-text-mute">
              TTM finishes in seconds. Kronos-base is CPU-only and can take
              several minutes per symbol — the row will poll itself to
              "done" while you keep working.
            </p>
            <button
              type="submit"
              disabled={busy || !modelKey}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              {busy ? "Starting…" : "Run backtest"}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-3 rounded-md border border-bear/40 bg-bear-soft p-2 text-xs text-bear">
            {error}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-text-mute">
            Past runs ({runs.length})
          </h2>
          <button
            type="button" onClick={refresh}
            className="text-xs text-text-mute hover:text-text"
          >
            Refresh
          </button>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
            No backtests yet. Run one above.
          </div>
        ) : (
          <ul className="space-y-2">
            {runs.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/backtests/${r.id}`}
                  className="block rounded-2xl border border-border bg-bg-card p-4 transition hover:border-accent/40"
                >
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <StatusPill status={r.status} />
                      <span className="text-sm font-medium">{r.model_key}</span>
                      <span className="num text-xs text-text-mute">
                        {r.symbols.length} {r.symbols.length === 1 ? "symbol" : "symbols"}
                      </span>
                    </div>
                    <div className="num text-xs text-text-mute">
                      {new Date(r.created_at).toLocaleString("en-GB", { hour12: false })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-text-dim sm:grid-cols-4">
                    <Stat label="forecasts" value={r.n_forecasts != null ? FMT_NUM.format(r.n_forecasts) : "—"} />
                    <Stat
                      label="hit-rate"
                      value={FMT_PCT(r.overall_hit_rate)}
                      tone={
                        r.overall_hit_rate == null ? "muted"
                        : r.overall_hit_rate >= 0.52 ? "bull"
                        : r.overall_hit_rate <= 0.48 ? "bear" : "muted"
                      }
                    />
                    <Stat
                      label="sim P&L"
                      value={r.overall_pnl_pct == null ? "—" : `${r.overall_pnl_pct.toFixed(2)}%`}
                      tone={
                        r.overall_pnl_pct == null ? "muted"
                        : r.overall_pnl_pct > 0 ? "bull"
                        : r.overall_pnl_pct < 0 ? "bear" : "muted"
                      }
                    />
                    <Stat
                      label="duration"
                      value={r.duration_secs == null ? "—" : `${r.duration_secs}s`}
                    />
                  </div>
                  <div className="mt-2 truncate text-[10px] text-text-mute">
                    {r.symbols.map(friendlySymbol).join(" · ")}
                  </div>
                  {r.error_message && (
                    <div className="mt-2 text-xs text-bear">{r.error_message}</div>
                  )}
                  {r.applied_actions.length > 0 && (
                    <div className="mt-2 text-[10px] text-bull">
                      ✓ applied to {r.applied_actions.length} agent change(s)
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg-elev-1 px-2 py-2 text-sm text-text outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-text-mute">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, tone = "muted" }: { label: string; value: string; tone?: "bull" | "bear" | "muted" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-text";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num text-sm ${cls}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: BacktestRun["status"] }) {
  const map: Record<BacktestRun["status"], { label: string; cls: string }> = {
    pending: { label: "queued", cls: "border-border text-text-mute" },
    running: { label: "running", cls: "border-accent/50 text-accent" },
    done: { label: "done", cls: "border-bull/50 text-bull" },
    failed: { label: "failed", cls: "border-bear/50 text-bear" },
  };
  const { label, cls } = map[status];
  return (
    <span className={`rounded-md border px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}>
      {label}
    </span>
  );
}
