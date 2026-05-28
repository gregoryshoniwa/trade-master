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
  buy: "text-bear",         // stake out
  sell: "text-bull",         // payout in
  deposit: "text-bull",
  withdrawal: "text-bear",
  adjustment: "text-text-dim",
  escrow: "text-text-dim",
};

type OutcomeFilter = "all" | "win" | "loss" | "breakeven";
type Filters = {
  action: string;          // "all" | "buy" | "sell" | …
  asset: string;           // "all" | code
  outcome: OutcomeFilter;
  search: string;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;
// Deriv caps a single call at 500. We load one big page client-side so
// filters can slice across the whole window without round-trips.
const SERVER_FETCH = 500;

export default function HistoryPage() {
  const { me, loading: authLoading } = useAuth();
  const [transactions, setTransactions] = useState<DerivStatementTransaction[]>([]);
  const [hasMoreOnServer, setHasMoreOnServer] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    action: "all", asset: "all", outcome: "all", search: "",
  });
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.getDerivStatement({ limit: SERVER_FETCH, offset: 0 });
      setTransactions(r.transactions);
      setHasMoreOnServer(r.transactions.length === SERVER_FETCH);
      setPage(1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadMoreFromBroker() {
    if (loading || !hasMoreOnServer) return;
    setLoading(true);
    try {
      const r = await api.getDerivStatement({ limit: SERVER_FETCH, offset: transactions.length });
      setTransactions((prev) => [...prev, ...r.transactions]);
      setHasMoreOnServer(r.transactions.length === SERVER_FETCH);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load more failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (me) refresh(); }, [me, refresh]);

  // ── Pair sells with buys via reference_id for accurate round-trip P&L.
  // Deriv stamps the original buy's transaction_id on the sell's reference_id.
  // Round-trip P&L = sell.amount + buy.amount (buy.amount is negative). A
  // sell of +$12.48 chasing a $25 buy is a -$12.52 LOSS, not a win.
  const pnlByTxId = useMemo(() => {
    const byTxId = new Map<number, DerivStatementTransaction>();
    for (const t of transactions) byTxId.set(t.transaction_id, t);
    const out = new Map<number, number>();
    for (const t of transactions) {
      if (t.action_type !== "sell" || !t.reference_id) continue;
      const buy = byTxId.get(t.reference_id);
      if (!buy || buy.action_type !== "buy") continue;
      out.set(t.transaction_id, t.amount + buy.amount);
    }
    return out;
  }, [transactions]);

  // Outcome lookup for the filter — only sells with a paired buy can be
  // classified. Sells whose buy is older than what we've fetched are "?".
  function outcomeOf(t: DerivStatementTransaction): "win" | "loss" | "breakeven" | "unknown" {
    if (t.action_type !== "sell") return "unknown";
    const p = pnlByTxId.get(t.transaction_id);
    if (p == null) return "unknown";
    if (p > 0.005) return "win";
    if (p < -0.005) return "loss";
    return "breakeven";
  }

  // ── Filtered + paged set ───────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return transactions.filter((t) => {
      if (filters.action !== "all" && t.action_type !== filters.action) return false;
      if (filters.asset !== "all" && (t.symbol ?? "") !== filters.asset) return false;
      if (filters.outcome !== "all" && outcomeOf(t) !== filters.outcome) return false;
      if (q) {
        const hay = (
          (t.longcode ?? "") + " " +
          (t.symbol ?? "") + " " +
          ACTION_LABEL[t.action_type] + " " +
          String(t.transaction_id) + " " +
          String(t.contract_id)
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, filters, pnlByTxId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize],
  );

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1); }, [filters, pageSize]);

  // ── Summary over the FULL loaded set (not filtered) ────────────────
  const summary = useMemo(() => {
    if (transactions.length === 0) {
      return { start: 0, end: 0, net: 0, trades: 0, wins: 0, losses: 0, breakeven: 0, unknown: 0 };
    }
    const ordered = [...transactions].reverse(); // chronological
    const start = ordered[0].balance_after - ordered[0].amount;
    const end = ordered[ordered.length - 1].balance_after;
    let trades = 0, wins = 0, losses = 0, breakeven = 0, unknown = 0;
    for (const t of transactions) {
      if (t.action_type !== "sell") continue;
      trades += 1;
      const o = outcomeOf(t);
      if (o === "win") wins += 1;
      else if (o === "loss") losses += 1;
      else if (o === "breakeven") breakeven += 1;
      else unknown += 1;
    }
    return { start, end, net: end - start, trades, wins, losses, breakeven, unknown };
  }, [transactions, pnlByTxId]);

  // Unique assets for the asset filter dropdown.
  const assetOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of transactions) if (t.symbol) s.add(t.symbol);
    return [...s].sort();
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
        <button type="button" onClick={refresh} disabled={loading}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-accent/40 hover:text-text disabled:opacity-50">
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
              sub={[
                `${summary.wins} won`,
                `${summary.losses} lost`,
                summary.breakeven ? `${summary.breakeven} flat` : "",
                summary.unknown ? `${summary.unknown} ?` : "",
              ].filter(Boolean).join(" · ")}
            />
          </div>
          <BalanceChart transactions={transactions} />
        </>
      )}

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <section className="mb-3 rounded-2xl border border-border bg-bg-card p-3">
        <div className="flex flex-wrap items-end gap-2">
          <FilterField label="Search">
            <input
              type="search"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              placeholder="asset, longcode, contract id…"
              className="w-48 rounded-md border border-border bg-bg-elev-1 px-2 py-1.5 text-xs outline-none focus:border-accent"
            />
          </FilterField>
          <FilterField label="Action">
            <select
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
              className="rounded-md border border-border bg-bg-elev-1 px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="all">All actions</option>
              {Object.keys(ACTION_LABEL).map((a) => (
                <option key={a} value={a}>{ACTION_LABEL[a]}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Asset">
            <select
              value={filters.asset}
              onChange={(e) => setFilters((f) => ({ ...f, asset: e.target.value }))}
              className="rounded-md border border-border bg-bg-elev-1 px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="all">All assets</option>
              {assetOptions.map((a) => (
                <option key={a} value={a}>{friendlySymbol(a)}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Outcome">
            <select
              value={filters.outcome}
              onChange={(e) => setFilters((f) => ({ ...f, outcome: e.target.value as OutcomeFilter }))}
              className="rounded-md border border-border bg-bg-elev-1 px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="all">All outcomes</option>
              <option value="win">Wins (P&L &gt; 0)</option>
              <option value="loss">Losses (P&L &lt; 0)</option>
              <option value="breakeven">Break-even</option>
            </select>
          </FilterField>
          <div className="ml-auto flex items-center gap-2 text-[10px] text-text-mute">
            <span className="num">
              {filtered.length} match{filtered.length === 1 ? "" : "es"}
              {" "}of {transactions.length} loaded
            </span>
            {(filters.action !== "all" || filters.asset !== "all" || filters.outcome !== "all" || filters.search) && (
              <button
                type="button"
                onClick={() => setFilters({ action: "all", asset: "all", outcome: "all", search: "" })}
                className="rounded border border-border px-2 py-1 hover:border-accent/40 hover:text-text"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Transaction table ──────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-border bg-bg-elev-1 text-xs uppercase tracking-widest text-text-mute">
              <tr>
                <th className="px-3 py-2 text-left">Time</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Asset</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-right">Round-trip</th>
                <th className="px-3 py-2 text-left">Detail</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((t) => {
                const tone = ACTION_COLOR[t.action_type] ?? "text-text";
                const label = ACTION_LABEL[t.action_type] ?? t.action_type;
                const pnl = pnlByTxId.get(t.transaction_id);
                return (
                  <tr key={t.transaction_id} className="border-b border-border last:border-0 hover:bg-bg-elev-1">
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
                    <td className={`num whitespace-nowrap px-3 py-2 text-right text-xs ${
                      t.amount > 0 ? "text-bull" : t.amount < 0 ? "text-bear" : "text-text-mute"
                    }`}>
                      {FMT_SIGN.format(t.amount)}
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-xs text-text">
                      {FMT_USD.format(t.balance_after)}
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-xs">
                      {pnl != null ? (
                        <span className={
                          pnl > 0.005 ? "text-bull"
                          : pnl < -0.005 ? "text-bear"
                          : "text-text-mute"
                        }>
                          {FMT_SIGN.format(pnl)}
                        </span>
                      ) : (
                        <span className="text-text-mute">—</span>
                      )}
                    </td>
                    <td className="max-w-[24rem] px-3 py-2 text-xs text-text-dim">
                      <span className="line-clamp-1" title={t.longcode ?? ""}>
                        {t.longcode ?? "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && !loading && !error && (
          <p className="px-3 py-8 text-center text-sm text-text-mute">
            {transactions.length === 0
              ? "No transactions yet. They'll appear here as trades settle on the broker."
              : "No transactions match the current filters."}
          </p>
        )}

        {/* ── Pagination footer ─────────────────────────────────── */}
        <Pager
          page={safePage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalRows={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          hasMoreOnServer={hasMoreOnServer}
          loading={loading}
          onLoadMoreFromBroker={loadMoreFromBroker}
        />
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-text-mute">{label}</span>
      {children}
    </label>
  );
}

function Pager({
  page, totalPages, pageSize, totalRows,
  onPageChange, onPageSizeChange, hasMoreOnServer, loading, onLoadMoreFromBroker,
}: {
  page: number; totalPages: number; pageSize: number; totalRows: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  hasMoreOnServer: boolean; loading: boolean;
  onLoadMoreFromBroker: () => void;
}) {
  const pageWindow = useMemo(() => {
    // Sliding window of up to 5 page numbers around the current page.
    const max = totalPages;
    const half = 2;
    let start = Math.max(1, page - half);
    let end = Math.min(max, start + half * 2);
    start = Math.max(1, end - half * 2);
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }, [page, totalPages]);

  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(totalRows, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-text-mute">
      <div className="flex items-center gap-3">
        <span className="num">
          {from}–{to} of {totalRows}
        </span>
        <label className="flex items-center gap-1">
          <span>Per page</span>
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded border border-border bg-bg-elev-1 px-1.5 py-1 outline-none focus:border-accent"
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1">
        <PageBtn disabled={page <= 1} onClick={() => onPageChange(1)} label="«" title="First" />
        <PageBtn disabled={page <= 1} onClick={() => onPageChange(page - 1)} label="‹" title="Prev" />
        {pageWindow.map((p) => (
          <PageBtn
            key={p}
            onClick={() => onPageChange(p)}
            label={String(p)}
            active={p === page}
          />
        ))}
        <PageBtn disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} label="›" title="Next" />
        <PageBtn disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} label="»" title="Last" />
      </div>

      {hasMoreOnServer && (
        <button
          type="button"
          onClick={onLoadMoreFromBroker}
          disabled={loading}
          className="rounded border border-border px-2 py-1 text-text-dim hover:border-accent/40 hover:text-text disabled:opacity-50"
          title="Fetch more from Deriv"
        >
          {loading ? "Loading…" : `+${500} from broker`}
        </button>
      )}
    </div>
  );
}

function PageBtn({
  label, onClick, disabled, active, title,
}: {
  label: string; onClick: () => void;
  disabled?: boolean; active?: boolean; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`num min-w-[28px] rounded border px-1.5 py-1 transition ${
        active
          ? "border-accent bg-accent text-white"
          : "border-border text-text-dim hover:border-accent/40 hover:text-text disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-text-dim"
      }`}
    >
      {label}
    </button>
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
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 4 },
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
    series.applyOptions({ lineColor: accent, topColor: accent + "55", bottomColor: accent + "00" });
  }, [theme]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (transactions.length === 0) { series.setData([]); return; }
    const byTime = new Map<number, number>();
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
