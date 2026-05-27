"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type TradeIntent } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const FMT_PRICE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export default function ApprovalsPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [pending, setPending] = useState<TradeIntent[]>([]);
  const [recent, setRecent] = useState<TradeIntent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([
        api.listPendingApprovals(activeCompanyId),
        api.listIntents(activeCompanyId, "all", 20),
      ]);
      setPending(p.intents);
      setRecent(r.intents);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId]);

  useEffect(() => {
    refresh();
    const reload = setInterval(refresh, 4_000);
    const tick = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => {
      clearInterval(reload);
      clearInterval(tick);
    };
  }, [refresh]);

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to review trade approvals.</p>
        <Link href="/login" className="rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg">Sign in</Link>
      </main>
    );
  }
  if (!active) {
    return <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">Select or create a company first.</main>;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{active.name} — Approvals</h1>
          <p className="text-xs text-text-mute">{pending.length} pending · {recent.length} in recent history</p>
        </div>
        <button type="button" onClick={refresh}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-bull/40 hover:text-text">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {error && <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      <section className="mb-8">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-text-mute">Pending — needs your sign-off</h2>
        {pending.length === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
            Nothing waiting. Active employee agents will surface proposals here when their confidence floor + tier checks pass.
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((i) => <PendingCard key={i.id} intent={i} companyId={active.id} nowMs={nowMs} onChanged={refresh} />)}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-xs uppercase tracking-widest text-text-mute">Recent</h2>
        {recent.length === 0 ? (
          <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">No agent decisions yet.</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg-elev-1 text-text-mute">
                <tr>
                  <Th>When</Th><Th>Agent</Th><Th>Asset</Th><Th>Side</Th>
                  <Th className="text-right">Stake</Th><Th className="text-right">Conf</Th>
                  <Th>Status</Th><Th className="text-right">P&amp;L</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <Td className="num text-xs text-text-mute">
                      {new Date(i.created_at).toLocaleTimeString("en-GB", { hour12: false })}
                    </Td>
                    <Td>{i.agent_name}</Td>
                    <Td className="num">{i.asset}</Td>
                    <Td><DirGlyph dir={i.direction} /><span className="num ml-1 text-text-dim">{i.contract_type}</span></Td>
                    <Td className="num text-right">{FMT_USD.format(i.stake_usd)}</Td>
                    <Td className="num text-right text-text-dim">{(i.confidence * 100).toFixed(0)}%</Td>
                    <Td><StatusPill status={i.status} /></Td>
                    <Td className="num text-right">
                      {i.realized_pnl_usd != null ? (
                        <span className={i.realized_pnl_usd >= 0 ? "text-bull" : "text-bear"}>
                          {i.realized_pnl_usd >= 0 ? "▲" : "▼"} {FMT_USD.format(Math.abs(i.realized_pnl_usd))}
                        </span>
                      ) : i.status === "executed" ? (
                        <span className="text-text-mute">open</span>
                      ) : (
                        <span className="text-text-mute">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function PendingCard({ intent, companyId, nowMs, onChanged }: {
  intent: TradeIntent; companyId: string; nowMs: number;
  onChanged: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expiryMs = intent.expires_at ? new Date(intent.expires_at).getTime() : 0;
  const secsLeft = expiryMs > 0 ? Math.max(0, Math.round((expiryMs - nowMs) / 1000)) : null;

  async function decide(kind: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      if (kind === "approve") await api.approveIntent(companyId, intent.id);
      else await api.rejectIntent(companyId, intent.id);
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "decision failed");
    } finally {
      setBusy(false);
    }
  }

  const dirColor = intent.direction === "up" ? "text-bull"
    : intent.direction === "down" ? "text-bear" : "text-neutral";

  return (
    <article className="rounded-2xl border border-bull/30 bg-bg-card p-5 shadow-glow">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-widest text-text-mute">{intent.agent_name}</span>
          <span className={`text-lg font-medium ${dirColor}`}>
            <DirGlyph dir={intent.direction} /> {intent.contract_type}
          </span>
          <span className="num text-text-dim">{intent.asset}</span>
        </div>
        {secsLeft != null && (
          <span className={`num text-xs ${secsLeft < 8 ? "text-bear" : "text-warning"}`}>⏱ {secsLeft}s</span>
        )}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <Stat label="Stake" value={FMT_USD.format(intent.stake_usd)} />
        <Stat label="Entry" value={FMT_PRICE.format(intent.entry_price)} />
        <Stat label="Stop" value={intent.stop_loss != null ? FMT_PRICE.format(intent.stop_loss) : "—"} />
        <Stat label="Target" value={intent.take_profit != null ? FMT_PRICE.format(intent.take_profit) : "—"} />
      </div>

      <p className="mb-3 text-sm text-text-dim">
        <span className="text-text">Why:</span> {intent.rationale}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-text-mute">
        <span>conf <span className="num text-text">{(intent.confidence * 100).toFixed(0)}%</span></span>
        {intent.expected_payoff_ratio != null && (
          <span>payoff <span className="num text-text">{intent.expected_payoff_ratio.toFixed(2)}×</span></span>
        )}
        {intent.expected_value_usd != null && (
          <span>EV <span className="num text-text">{FMT_USD.format(intent.expected_value_usd)}</span></span>
        )}
        <span>via {intent.source_model}</span>
      </div>

      {intent.risk_verdict && <RiskBreakdown verdict={intent.risk_verdict} />}

      {error && (
        <div className="mt-3 rounded-md border border-bear/40 bg-bear-soft p-2 text-xs text-bear">{error}</div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={() => decide("reject")}
          className="rounded-md border border-border px-3 py-2 text-sm text-text-dim hover:border-bear/50 hover:text-bear disabled:opacity-50">
          Reject
        </button>
        <button type="button" disabled={busy} onClick={() => decide("approve")}
          className="rounded-md bg-bull px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50">
          {busy ? "Saving…" : "Approve"}
        </button>
      </div>
    </article>
  );
}

function RiskBreakdown({ verdict }: { verdict: TradeIntent["risk_verdict"] }) {
  const [open, setOpen] = useState(false);
  if (!verdict) return null;
  return (
    <div className="rounded-md bg-bg-elev-1 p-2 text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-text-mute hover:text-text">
        <span>
          Risk Agent: {verdict.ok ? <span className="text-bull">passed</span> : <span className="text-bear">blocked — {verdict.reason}</span>}{" "}
          ({verdict.checks.length} checks)
        </span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {verdict.checks.map((c) => (
            <li key={c.name} className={`flex items-baseline gap-2 ${c.passed ? "text-text-dim" : "text-bear"}`}>
              <span>{c.passed ? "✓" : "✗"}</span>
              <span className="num">{c.name}</span>
              {c.detail && <span className="text-text-mute">— {c.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DirGlyph({ dir }: { dir: TradeIntent["direction"] }) {
  if (dir === "up") return <span className="text-bull">▲</span>;
  if (dir === "down") return <span className="text-bear">▼</span>;
  return <span className="text-neutral">●</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bg-elev-1 p-2">
      <div className="text-text-mute">{label}</div>
      <div className="num mt-0.5 text-text">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: TradeIntent["status"] }) {
  const map: Record<TradeIntent["status"], { label: string; cls: string }> = {
    pending_risk: { label: "risk check", cls: "border-warning/40 text-warning" },
    rejected_by_risk: { label: "risk-rejected", cls: "border-bear/40 text-bear" },
    pending_approval: { label: "pending", cls: "border-warning/40 text-warning" },
    approved: { label: "approved", cls: "border-bull/40 text-bull" },
    auto_approved: { label: "auto-approved", cls: "border-bull/40 text-bull" },
    rejected_by_user: { label: "rejected", cls: "border-bear/40 text-bear" },
    expired: { label: "expired", cls: "border-border text-text-mute" },
    executed: { label: "executed", cls: "border-bull/40 text-bull" },
    failed_execution: { label: "exec failed", cls: "border-bear/40 text-bear" },
  };
  const { label, cls } = map[status];
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}>{label}</span>;
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-widest ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 align-top ${className}`}>{children}</td>;
}
