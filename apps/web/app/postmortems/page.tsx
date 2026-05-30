"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  ApiError,
  type Postmortem,
  type PostmortemFacets,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { friendlySymbol } from "@/lib/symbols";
import SymbolIcon from "@/components/SymbolIcon";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const PAGE_SIZE = 25;

type Outcome = "win" | "loss" | "neutral";

export default function PostmortemsPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [items, setItems] = useState<Postmortem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Filters + pagination
  const [agentId, setAgentId] = useState<string>("");
  const [asset, setAsset] = useState<string>("");
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [q, setQ] = useState<string>("");
  const [debouncedQ, setDebouncedQ] = useState<string>("");
  const [page, setPage] = useState(0);
  const [facets, setFacets] = useState<PostmortemFacets>({ assets: [], agents: [] });

  // 300ms debounce so each keystroke doesn't refetch.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  // Reset to page 0 whenever a filter changes — otherwise an empty page
  // (e.g. you filter for an asset that only has 3 results while on page 4)
  // looks like "no results" when there really are some.
  useEffect(() => {
    setPage(0);
  }, [agentId, asset, outcome, debouncedQ]);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listPostmortems(activeCompanyId, {
        agentId: agentId || undefined,
        asset: asset || undefined,
        outcome: outcome || undefined,
        q: debouncedQ || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(r.postmortems);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, agentId, asset, outcome, debouncedQ, page]);

  useEffect(() => {
    refresh();
    // Auto-refresh only on page 0 with no filters — otherwise the polling
    // tug-of-war steals page state from the user.
    const idle = page === 0 && !agentId && !asset && !outcome && !debouncedQ;
    if (!idle) return;
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh, page, agentId, asset, outcome, debouncedQ]);

  // Facets load once per company; they're the dropdown source.
  useEffect(() => {
    if (!activeCompanyId) return;
    api.listPostmortemFacets(activeCompanyId).then(setFacets).catch(() => { /* ignore */ });
  }, [activeCompanyId]);

  const filtered = !!(agentId || asset || outcome || debouncedQ);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  // Roll-ups on this page (NOT global) — clear about scope.
  const wins = useMemo(() => items.filter((p) => p.outcome === "win").length, [items]);
  const losses = useMemo(() => items.filter((p) => p.outcome === "loss").length, [items]);
  const net = useMemo(() => items.reduce((s, p) => s + p.pnl_usd, 0), [items]);

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to review trade postmortems.</p>
        <Link href="/login" className="rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg">Sign in</Link>
      </main>
    );
  }
  if (!active) {
    return <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">Select or create a company first.</main>;
  }

  function clearFilters() {
    setAgentId(""); setAsset(""); setOutcome(""); setQ("");
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{active.name} — Postmortems</h1>
          <p className="text-xs text-text-mute">
            Every settled trade, analysed: what the agent saw, why it acted, how it closed, and how it scored.
          </p>
        </div>
        <button type="button" onClick={refresh}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-bull/40 hover:text-text">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="mb-4 rounded-2xl border border-border bg-bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-5">
          <Filter label="Agent">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={selectCls}>
              <option value="">All agents</option>
              {facets.agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Filter>
          <Filter label="Asset">
            <select value={asset} onChange={(e) => setAsset(e.target.value)} className={selectCls}>
              <option value="">All assets</option>
              {facets.assets.map((s) => (
                <option key={s} value={s}>{friendlySymbol(s)}</option>
              ))}
            </select>
          </Filter>
          <Filter label="Outcome">
            <select value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome | "")} className={selectCls}>
              <option value="">All outcomes</option>
              <option value="win">Wins only</option>
              <option value="loss">Losses only</option>
              <option value="neutral">Neutral</option>
            </select>
          </Filter>
          <Filter label="Search narrative">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="e.g. trend reversal, EMA"
              className={selectCls}
            />
          </Filter>
          <Filter label="&nbsp;">
            <button
              type="button"
              onClick={clearFilters}
              disabled={!filtered}
              className="h-full rounded-md border border-border px-3 py-2 text-xs text-text-dim hover:border-bull/40 hover:text-text disabled:opacity-40"
            >
              Clear filters
            </button>
          </Filter>
        </div>
      </section>

      <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
        <SummaryStat label={filtered ? "Matching" : "Total settled"} value={String(total)} />
        <SummaryStat label={`This page (${items.length})`} value={`${wins} W / ${losses} L`} />
        <SummaryStat
          label="P&L (this page)"
          value={FMT_USD.format(net)}
          cls={net >= 0 ? "text-bull" : "text-bear"}
        />
      </div>

      {error && <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      {total === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
          {filtered
            ? "No postmortems match these filters. Try clearing one."
            : "No settled trades yet. Postmortems are generated automatically when a contract closes."}
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {items.map((p) => <PostmortemCard key={p.id} pm={p} />)}
          </div>
          <nav className="mt-6 flex items-center justify-between text-xs text-text-mute">
            <span className="num">
              {pageStart}–{pageEnd} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="rounded-md border border-border px-2 py-1 hover:border-bull/40 hover:text-text disabled:opacity-40"
              >
                ◂ Prev
              </button>
              <span className="num">page {page + 1} / {pageCount}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1 || loading}
                className="rounded-md border border-border px-2 py-1 hover:border-bull/40 hover:text-text disabled:opacity-40"
              >
                Next ▸
              </button>
            </div>
          </nav>
        </>
      )}
    </main>
  );
}

const selectCls =
  "w-full rounded-md border border-border bg-bg-elev-1 px-2 py-1.5 text-xs text-text outline-none focus:border-accent";

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-text-mute">{label}</span>
      {children}
    </label>
  );
}

function PostmortemCard({ pm }: { pm: Postmortem }) {
  const [open, setOpen] = useState(false);
  const win = pm.outcome === "win";
  const outcomeCls = win ? "text-bull" : pm.outcome === "loss" ? "text-bear" : "text-neutral";
  const borderCls = win ? "border-bull/30" : pm.outcome === "loss" ? "border-bear/30" : "border-border";

  const rating = pm.employee_rating;
  const composite = rating?.composite_rating ?? 0;

  return (
    <article className={`rounded-2xl border ${borderCls} bg-bg-card p-5`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-widest text-text-mute">{pm.agent_name ?? "agent"}</span>
          <span className={`text-base font-medium ${outcomeCls}`}>
            <DirGlyph dir={pm.direction} /> {pm.contract_type}
          </span>
          <span className="inline-flex items-center gap-1 text-text-dim">
            {pm.asset && <SymbolIcon code={pm.asset} size={14} />}
            <span className="num">{pm.asset ? friendlySymbol(pm.asset) : "—"}</span>
          </span>
        </div>
        <div className="flex items-baseline gap-3">
          <span className={`num text-sm font-medium ${win ? "text-bull" : pm.pnl_usd < 0 ? "text-bear" : "text-text-dim"}`}>
            {pm.pnl_usd >= 0 ? "▲" : "▼"} {FMT_USD.format(Math.abs(pm.pnl_usd))}
          </span>
          <span className="text-xs text-text-mute">
            {new Date(pm.generated_at).toLocaleString("en-GB", { hour12: false })}
          </span>
        </div>
      </div>

      <p className="mb-3 whitespace-pre-line text-sm text-text-dim">{pm.narrative}</p>

      <div className="mb-1 flex flex-wrap items-center gap-4 text-xs">
        <RatingBar label="Composite" value={composite} />
        <span className="text-text-mute">
          direction <span className="num text-text">{fmtScore(rating?.direction_score)}</span>
        </span>
        <span className="text-text-mute">
          calibration <span className="num text-text">{fmtScore(rating?.calibration_score)}</span>
        </span>
        {rating?.information_value_score == null && (
          <span className="text-text-mute italic">info-value: n/a (single decider)</span>
        )}
      </div>

      <button type="button" onClick={() => setOpen((v) => !v)}
        className="mt-2 text-xs text-text-mute hover:text-text">
        {open ? "▾ Hide decision trace" : "▸ Show decision trace"}
      </button>

      {open && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <TracePanel title="Entry — why it traded" trace={pm.entry_trace} />
          <TracePanel title="Exit — how it closed" trace={pm.exit_trace} />
        </div>
      )}
    </article>
  );
}

function TracePanel({ title, trace }: { title: string; trace: Record<string, unknown> }) {
  return (
    <div className="rounded-md bg-bg-elev-1 p-3">
      <div className="mb-2 text-xs uppercase tracking-widest text-text-mute">{title}</div>
      <pre className="num overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-dim">
        {JSON.stringify(trace, null, 2)}
      </pre>
    </div>
  );
}

function RatingBar({ label, value }: { label: string; value: number }) {
  // value in [-1, 1] → bar fill + color
  const pct = Math.round(((value + 1) / 2) * 100);
  const cls = value >= 0.2 ? "bg-bull" : value <= -0.2 ? "bg-bear" : "bg-neutral";
  return (
    <span className="flex items-center gap-2 text-text-mute">
      {label}
      <span className="relative inline-block h-2 w-20 overflow-hidden rounded-full bg-bg-elev-2">
        <span className={`absolute inset-y-0 left-0 ${cls}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="num text-text">{value.toFixed(2)}</span>
    </span>
  );
}

function fmtScore(v: number | null | undefined): string {
  return v == null ? "—" : v.toFixed(2);
}

function DirGlyph({ dir }: { dir: string | null }) {
  if (dir === "up") return <span className="text-bull">▲</span>;
  if (dir === "down") return <span className="text-bear">▼</span>;
  return <span className="text-neutral">●</span>;
}

function SummaryStat({ label, value, cls = "text-text" }: { label: string; value: string; cls?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 text-lg font-medium ${cls}`}>{value}</div>
    </div>
  );
}
