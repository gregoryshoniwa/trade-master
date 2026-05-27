"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type Postmortem } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export default function PostmortemsPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [items, setItems] = useState<Postmortem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listPostmortems(activeCompanyId, { limit: 50 });
      setItems(r.postmortems);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8_000);
    return () => clearInterval(t);
  }, [refresh]);

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

  const wins = items.filter((p) => p.outcome === "win").length;
  const losses = items.filter((p) => p.outcome === "loss").length;
  const net = items.reduce((s, p) => s + p.pnl_usd, 0);

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

      {items.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-3 text-sm">
          <SummaryStat label="Settled" value={String(items.length)} />
          <SummaryStat label="Win / Loss" value={`${wins} / ${losses}`} />
          <SummaryStat
            label="Net P&L"
            value={FMT_USD.format(net)}
            cls={net >= 0 ? "text-bull" : "text-bear"}
          />
        </div>
      )}

      {error && <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
          No settled trades yet. Postmortems are generated automatically when a contract closes.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((p) => <PostmortemCard key={p.id} pm={p} />)}
        </div>
      )}
    </main>
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
          <span className="num text-text-dim">{pm.asset}</span>
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
