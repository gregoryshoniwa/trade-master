"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type AttributionSummary, type AttributionWindow } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { friendlySymbol } from "@/lib/symbols";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

const WINDOWS: { v: AttributionWindow; label: string }[] = [
  { v: "today", label: "Today" },
  { v: "7d",    label: "7d" },
  { v: "30d",   label: "30d" },
  { v: "all",   label: "All time" },
];

export default function AttributionPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;
  const [window, setWindow] = useState<AttributionWindow>("30d");
  const [data, setData] = useState<AttributionSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.getAttribution(activeCompanyId, window));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, window]);

  useEffect(() => { refresh(); }, [refresh]);

  if (authLoading) return <div className="px-6 py-8 text-sm text-text-mute">Loading…</div>;
  if (!me) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to view performance attribution.</p>
        <Link href="/login" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">Sign in</Link>
      </div>
    );
  }
  if (!active) {
    return <div className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">Select a company first.</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{active.name} — Attribution</h1>
          <p className="text-xs text-text-mute">
            Per-agent, per-model, per-asset P&amp;L — sourced from settled trades.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WindowPicker value={window} onChange={setWindow} />
          <button
            type="button" onClick={refresh}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-accent/40 hover:text-text"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      {data && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Stat label="Settled trades" value={String(data.trades)} />
          <Stat label="Net P&L" value={FMT_USD.format(data.pnl_usd)}
                tone={data.pnl_usd > 0 ? "bull" : data.pnl_usd < 0 ? "bear" : "muted"} />
          <Stat label="Win rate" value={`${(data.win_rate * 100).toFixed(1)}%`}
                tone={data.win_rate > 0.55 ? "bull" : data.win_rate < 0.45 ? "bear" : "muted"} />
        </div>
      )}

      {data && data.trades === 0 && (
        <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
          No settled trades in this window. Postmortems generate as positions close.
        </div>
      )}

      {data && data.by_agent.length > 0 && (
        <Section title="By agent">
          <Table headers={["Agent", "Trades", "Win rate", "Net P&L", "Avg", "Best", "Worst", "Calibration"]}>
            {data.by_agent.map((a) => (
              <tr key={a.agent_id ?? a.agent_name ?? "?"} className="border-b border-border last:border-0">
                <Td>{a.agent_name ?? "—"}</Td>
                <Td className="num text-right">{a.trades}</Td>
                <Td className="num text-right">{(a.win_rate * 100).toFixed(0)}%</Td>
                <Td className={`num text-right ${a.pnl_usd >= 0 ? "text-bull" : "text-bear"}`}>
                  {FMT_USD.format(a.pnl_usd)}
                </Td>
                <Td className="num text-right text-text-dim">{FMT_USD.format(a.avg_pnl_usd)}</Td>
                <Td className="num text-right text-bull">{FMT_USD.format(a.best_usd)}</Td>
                <Td className="num text-right text-bear">{FMT_USD.format(a.worst_usd)}</Td>
                <Td className="num text-right text-text-dim">
                  {a.avg_calibration != null ? a.avg_calibration.toFixed(2) : "—"}
                </Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {data && data.by_model.length > 0 && (
        <Section title="By forecasting model">
          <Table headers={["Model", "Trades", "Win rate", "Net P&L", "Avg"]}>
            {data.by_model.map((m) => (
              <tr key={m.source_model} className="border-b border-border last:border-0">
                <Td className="num">{m.source_model}</Td>
                <Td className="num text-right">{m.trades}</Td>
                <Td className="num text-right">{(m.win_rate * 100).toFixed(0)}%</Td>
                <Td className={`num text-right ${m.pnl_usd >= 0 ? "text-bull" : "text-bear"}`}>
                  {FMT_USD.format(m.pnl_usd)}
                </Td>
                <Td className="num text-right text-text-dim">{FMT_USD.format(m.avg_pnl_usd)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}

      {data && data.by_asset.length > 0 && (
        <Section title="By asset">
          <Table headers={["Asset", "Trades", "Win rate", "Net P&L", "Avg"]}>
            {data.by_asset.map((s) => (
              <tr key={s.asset} className="border-b border-border last:border-0">
                <Td>{friendlySymbol(s.asset)}</Td>
                <Td className="num text-right">{s.trades}</Td>
                <Td className="num text-right">{(s.win_rate * 100).toFixed(0)}%</Td>
                <Td className={`num text-right ${s.pnl_usd >= 0 ? "text-bull" : "text-bear"}`}>
                  {FMT_USD.format(s.pnl_usd)}
                </Td>
                <Td className="num text-right text-text-dim">{FMT_USD.format(s.avg_pnl_usd)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      )}
    </div>
  );
}

function WindowPicker({ value, onChange }: { value: AttributionWindow; onChange: (v: AttributionWindow) => void }) {
  return (
    <div className="flex gap-1 rounded-md border border-border bg-bg-elev-1 p-1 text-xs">
      {WINDOWS.map((w) => (
        <button key={w.v} type="button" onClick={() => onChange(w.v)}
          className={`rounded px-2 py-1 transition ${value === w.v ? "bg-accent text-white" : "text-text-dim hover:text-text"}`}>
          {w.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-text-mute">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">{children}</div>
    </section>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border bg-bg-elev-1 text-xs uppercase tracking-widest text-text-mute">
        <tr>{headers.map((h, i) => (
          <th key={h} className={`px-3 py-2 ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>
        ))}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function Stat({ label, value, tone = "muted" }: { label: string; value: string; tone?: "bull" | "bear" | "muted" }) {
  const cls = tone === "bull" ? "text-bull" : tone === "bear" ? "text-bear" : "text-text";
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 text-2xl font-medium ${cls}`}>{value}</div>
    </div>
  );
}
