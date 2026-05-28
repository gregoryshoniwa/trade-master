"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  createChart,
  type AreaData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";

import { api, ApiError, type DerivStatementTransaction } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cssVar, useTheme } from "@/lib/theme";
import { friendlySymbol } from "@/lib/symbols";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const FMT_SIGN = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", signDisplay: "always",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const ACTION_LABEL: Record<string, string> = {
  buy: "Buy",
  sell: "Sell",
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  adjustment: "Adjustment",
  escrow: "Escrow",
  virtual_credit: "Demo credit",
};

const ACTION_COLOR: Record<string, string> = {
  buy: "text-bear",          // money out
  sell: "text-bull",         // money back in
  deposit: "text-bull",
  withdrawal: "text-bear",
  adjustment: "text-text-dim",
  escrow: "text-text-dim",
};

const PAGE_SIZE = 200;

export default function HistoryPage() {
  const { me, loading: authLoading } = useAuth();
  const [transactions, setTransactions] = useState<DerivStatementTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getDerivStatement({ limit: PAGE_SIZE, offset: 0 });
      setTransactions(r.transactions);
      setHasMore(r.transactions.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const r = await api.getDerivStatement({ limit: PAGE_SIZE, offset: transactions.length });
      setTransactions((prev) => [...prev, ...r.transactions]);
      setHasMore(r.transactions.length === PAGE_SIZE);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load more failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!me) return;
    refresh();
  }, [me, refresh]);

  // ── Summary stats (ascending order to get start/end correct) ───────
  const summary = useMemo(() => {
    if (transactions.length === 0) {
      return { start: 0, end: 0, net: 0, trades: 0, deposits: 0, wins: 0, losses: 0 };
    }
    // Deriv returns newest-first; reverse for chronological math.
    const ordered = [...transactions].reverse();
    const start = ordered[0].balance_after - ordered[0].amount;
    const end = ordered[ordered.length - 1].balance_after;
    let deposits = 0, wins = 0, losses = 0, trades = 0;
    for (const t of ordered) {
      if (t.action_type === "deposit" || t.action_type === "virtual_credit") deposits += t.amount;
      else if (t.action_type === "buy") { trades += 1; }
      else if (t.action_type === "sell") {
        if (t.amount > 0) wins += 1; else if (t.amount < 0) losses += 1;
      }
    }
    return { start, end, net: end - start, trades, deposits, wins, losses };
  }, [transactions]);

  if (authLoading) return <div className="px-6 py-8 text-sm text-text-mute">Loading…</div>;
  if (!me) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to view transaction history.</p>
        <Link href="/login" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">Sign in</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Transaction history</h1>
          <p className="text-xs text-text-mute">
            Authoritative broker-side ledger from Deriv — every buy, sell,
            settle, deposit, and adjustment. Newest first.
          </p>
        </div>
        <button
          type="button" onClick={refresh}
          disabled={loading}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-accent/40 hover:text-text disabled:opacity-50"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
          {error}
        </div>
      )}

      {transactions.length > 0 && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Start" value={FMT_USD.format(summary.start)} />
            <Stat label="Current" value={FMT_USD.format(summary.end)} />
            <Stat
              label="Net"
              value={FMT_SIGN.format(summary.net)}
              tone={summary.net > 0 ? "bull" : summary.net < 0 ? "bear" : "muted"}
            />
            <Stat
              label="Trades"
              value={String(summary.trades)}
              sub={`${summary.wins} won · ${summary.losses} lost`}
            />
          </div>

          <BalanceChart transactions={transactions} />
        </>
      )}

      <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg-elev-1 text-xs uppercase tracking-widest text-text-mute">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Asset</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Balance</th>
              <th className="px-3 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => {
              const tone = ACTION_COLOR[t.action_type] ?? "text-text";
              const label = ACTION_LABEL[t.action_type] ?? t.action_type;
              return (
                <tr key={t.transaction_id} className="border-b border-border last:border-0">
                  <td className="num whitespace-nowrap px-3 py-2 text-xs text-text-mute">
                    {new Date(t.transaction_time * 1000).toLocaleString("en-GB", {
                      hour12: false, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className={tone}>{label}</span>
                  </td>
                  <td className="num px-3 py-2 text-xs text-text-dim">
                    {t.symbol ? friendlySymbol(t.symbol) : "—"}
                  </td>
                  <td className={`num px-3 py-2 text-right text-xs ${
                    t.amount > 0 ? "text-bull" : t.amount < 0 ? "text-bear" : "text-text-mute"
                  }`}>
                    {FMT_SIGN.format(t.amount)}
                  </td>
                  <td className="num px-3 py-2 text-right text-xs text-text">
                    {FMT_USD.format(t.balance_after)}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-dim">
                    <span className="line-clamp-1" title={t.longcode ?? ""}>
                      {t.longcode ?? "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {transactions.length === 0 && !loading && !error && (
          <p className="px-3 py-8 text-center text-sm text-text-mute">
            No transactions yet. They'll appear here as trades settle on the broker.
          </p>
        )}
        {hasMore && transactions.length > 0 && (
          <div className="border-t border-border p-3 text-center">
            <button
              type="button" onClick={loadMore} disabled={loading}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-accent/40 hover:text-text disabled:opacity-50"
            >
              {loading ? "Loading…" : `Load ${PAGE_SIZE} more`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Balance chart ────────────────────────────────────────────────

function BalanceChart({ transactions }: { transactions: DerivStatementTransaction[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;
    const accent = cssVar("--color-accent") || "#2962FF";
    const text = cssVar("--color-text-dim") || "#9BA3AF";
    const border = cssVar("--color-border") || "#252C36";
    const bg = cssVar("--color-bg-card") || "#161B22";
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: bg }, textColor: text,
        fontFamily: 'ui-monospace, "JetBrains Mono Variable", "IBM Plex Mono", Menlo, monospace',
      },
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border },
      timeScale: {
        borderColor: border, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 4,
      },
      width: containerRef.current.clientWidth,
      height: 200,
      crosshair: { vertLine: { color: accent }, horzLine: { color: accent } },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: accent,
      topColor: accent + "55",
      bottomColor: accent + "00",
      lineWidth: 2,
      priceLineVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Re-skin on theme flip.
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const accent = cssVar("--color-accent") || "#2962FF";
    const text = cssVar("--color-text-dim") || "#9BA3AF";
    const border = cssVar("--color-border") || "#252C36";
    const bg = cssVar("--color-bg-card") || "#161B22";
    chart.applyOptions({
      layout: { background: { color: bg }, textColor: text },
      grid: { vertLines: { color: border }, horzLines: { color: border } },
      rightPriceScale: { borderColor: border },
      timeScale: { borderColor: border },
      crosshair: { vertLine: { color: accent }, horzLine: { color: accent } },
    });
    series.applyOptions({
      lineColor: accent, topColor: accent + "55", bottomColor: accent + "00",
    });
  }, [theme]);

  // Push the data: transactions are newest-first; chart needs chronological.
  // Coalesce same-second entries by taking the last balance for that second
  // (Deriv can stamp multiple txs in the same second; the chart series
  // requires strictly ascending unique timestamps).
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (transactions.length === 0) { series.setData([]); return; }
    const byTime = new Map<number, number>();
    // Iterate oldest-first so later txs in the same second overwrite earlier.
    for (let i = transactions.length - 1; i >= 0; i--) {
      const t = transactions[i];
      byTime.set(t.transaction_time, t.balance_after);
    }
    const data: AreaData<Time>[] = [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [transactions]);

  return (
    <section className="mb-4 rounded-2xl border border-border bg-bg-card p-3">
      <div className="mb-2 px-1 text-xs uppercase tracking-widest text-text-mute">
        Balance over time
      </div>
      <div ref={containerRef} className="w-full" />
    </section>
  );
}

function Stat({ label, value, sub, tone = "muted" }: {
  label: string; value: string; sub?: string; tone?: "bull" | "bear" | "muted";
}) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-text";
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 truncate text-2xl font-medium ${cls}`} title={value}>{value}</div>
      {sub && <div className="truncate text-xs text-text-mute">{sub}</div>}
    </div>
  );
}
