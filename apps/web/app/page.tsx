"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import AssetPicker from "@/components/AssetPicker";
import TickChart from "@/components/TickChart";
import { api, type SymbolDef, type TradeIntent } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FALLBACK_SYMBOL = "frxEURUSD";

function activeSymbolKey(companyId: string | null): string {
  return `tm.activeSymbol.${companyId ?? "_anon"}`;
}

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FMT_PRICE = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

export default function DashboardPage() {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8080";
  const envSymbol = process.env.NEXT_PUBLIC_DEFAULT_SYMBOL ?? FALLBACK_SYMBOL;

  const { loading, me, companies, activeCompanyId } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [symbol, setSymbol] = useState<string>(envSymbol);
  const [symbolMeta, setSymbolMeta] = useState<SymbolDef | null>(null);
  const [intents, setIntents] = useState<TradeIntent[]>([]);

  // Restore symbol choice when active company changes.
  useEffect(() => {
    const stored = localStorage.getItem(activeSymbolKey(activeCompanyId));
    if (stored) setSymbol(stored);
  }, [activeCompanyId]);

  // Lookup display metadata for the current symbol.
  useEffect(() => {
    api.listSymbols().then((r) => {
      setSymbolMeta(r.symbols.find((s) => s.code === symbol) ?? null);
    });
  }, [symbol]);

  // Poll recent intents to drive the chart overlays + rail panels.
  const refreshIntents = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const r = await api.listIntents(activeCompanyId, "all", 100);
      setIntents(r.intents);
    } catch {
      /* the AuthProvider will redirect on 401s; transient errors don't need UI */
    }
  }, [activeCompanyId]);

  useEffect(() => {
    refreshIntents();
    const t = setInterval(refreshIntents, 5000);
    return () => clearInterval(t);
  }, [refreshIntents]);

  function chooseSymbol(code: string) {
    setSymbol(code);
    localStorage.setItem(activeSymbolKey(activeCompanyId), code);
  }

  // ── Derived data for the dashboard ──────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const todays = useMemo(
    () => intents.filter((i) => i.created_at.startsWith(today)),
    [intents, today],
  );
  const openPositions = useMemo(
    () => intents.filter((i) => i.status === "executed" && i.closed_at == null),
    [intents],
  );
  const todayPnl = useMemo(
    () =>
      todays.reduce(
        (sum, i) => sum + (i.realized_pnl_usd ?? 0),
        0,
      ),
    [todays],
  );
  const symbolIntents = useMemo(
    () => intents.filter((i) => i.asset === symbol).slice(0, 30),
    [intents, symbol],
  );

  // ── Empty / unauthenticated states ──────────────────────────────────
  if (!loading && !me) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="mb-2 text-2xl font-semibold">TradeMaster</h1>
        <p className="mb-6 text-sm text-text-mute">
          AI-orchestrated multi-model trading on Deriv.
        </p>
        <Link
          href="/login"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* Header strip */}
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {active ? `${active.name} — Dashboard` : "Dashboard"}
          </h1>
          {active && (
            <p className="text-xs text-text-mute">
              Tier {active.current_asset_tier} ·{" "}
              {active.unlocked_contract_types.join(", ")} ·{" "}
              <span className="text-bull">paper mode</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <AssetPicker value={symbol} onChange={chooseSymbol} />
          {!loading && me && companies.length === 0 && (
            <Link
              href="/companies/new"
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-strong"
            >
              + Create your first company
            </Link>
          )}
        </div>
      </header>

      {/* Stat cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Today's P&L"
          value={FMT_USD.format(todayPnl)}
          tone={todayPnl > 0 ? "bull" : todayPnl < 0 ? "bear" : "muted"}
        />
        <StatCard
          label="Open positions"
          value={String(openPositions.length)}
          tone={openPositions.length > 0 ? "accent" : "muted"}
        />
        <StatCard
          label="Intents today"
          value={String(todays.length)}
          tone="muted"
          sub={`${todays.filter((i) => i.status === "executed").length} executed`}
        />
        <StatCard
          label="Symbol"
          value={symbolMeta?.display ?? symbol}
          tone="muted"
          sub={symbolMeta?.asset_class ?? ""}
        />
      </div>

      {/* Main: chart + right rail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <TickChart
            symbol={symbol}
            wsUrl={`${wsUrl}/ws/ticks`}
            decimals={symbolMeta?.decimals ?? 4}
            displayName={symbolMeta?.display}
            intents={symbolIntents}
          />
        </div>
        <div className="flex flex-col gap-4">
          <OpenPositionsPanel positions={openPositions} />
          <ActivityPanel intents={intents.slice(0, 12)} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────

function StatCard({
  label, value, tone = "muted", sub,
}: {
  label: string; value: string;
  tone?: "bull" | "bear" | "accent" | "muted";
  sub?: string;
}) {
  const toneCls =
    tone === "bull" ? "text-bull"
    : tone === "bear" ? "text-bear"
    : tone === "accent" ? "text-accent"
    : "text-text";
  return (
    <div className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 text-2xl font-medium ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-text-mute">{sub}</div>}
    </div>
  );
}

function OpenPositionsPanel({ positions }: { positions: TradeIntent[] }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-widest text-text-mute">Open positions</h2>
        <span className="num text-xs text-text-mute">{positions.length}</span>
      </div>
      {positions.length === 0 ? (
        <p className="text-xs text-text-mute">Nothing open right now.</p>
      ) : (
        <ul className="space-y-2">
          {positions.map((p) => (
            <li key={p.id} className="rounded-md border border-border bg-bg-elev-1 p-2 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-text">{p.agent_name}</span>
                <DirGlyph dir={p.direction} />
              </div>
              <div className="mt-1 flex items-baseline justify-between text-text-mute">
                <span className="num">{p.asset}</span>
                <span className="num">{FMT_USD.format(p.stake_usd)}</span>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-2 text-[10px] text-text-mute">
                <span>entry <span className="num text-text">{FMT_PRICE.format(p.entry_price)}</span></span>
                <span>stop <span className="num text-bear">{p.stop_loss != null ? FMT_PRICE.format(p.stop_loss) : "—"}</span></span>
                <span>tgt <span className="num text-bull">{p.take_profit != null ? FMT_PRICE.format(p.take_profit) : "—"}</span></span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActivityPanel({ intents }: { intents: TradeIntent[] }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs uppercase tracking-widest text-text-mute">Activity</h2>
        <span className="num text-xs text-text-mute">{intents.length}</span>
      </div>
      {intents.length === 0 ? (
        <p className="text-xs text-text-mute">No recent activity.</p>
      ) : (
        <ul className="space-y-1.5">
          {intents.map((i) => (
            <li key={i.id} className="flex items-baseline gap-2 text-xs">
              <span className="num text-text-mute">
                {new Date(i.created_at).toLocaleTimeString("en-GB", { hour12: false })}
              </span>
              <span className="text-text">{i.agent_name}</span>
              <DirGlyph dir={i.direction} />
              <span className="num text-text-mute">{i.asset}</span>
              <span className="ml-auto">
                {i.realized_pnl_usd != null ? (
                  <span className={i.realized_pnl_usd >= 0 ? "text-bull" : "text-bear"}>
                    {i.realized_pnl_usd >= 0 ? "+" : ""}{i.realized_pnl_usd.toFixed(2)}
                  </span>
                ) : (
                  <StatusDot status={i.status} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DirGlyph({ dir }: { dir: TradeIntent["direction"] }) {
  if (dir === "up") return <span className="text-bull">▲</span>;
  if (dir === "down") return <span className="text-bear">▼</span>;
  return <span className="text-text-mute">●</span>;
}

function StatusDot({ status }: { status: TradeIntent["status"] }) {
  const color =
    status === "executed" ? "text-accent"
    : status === "auto_approved" || status === "approved" ? "text-bull"
    : status.startsWith("rejected") || status === "failed_execution" ? "text-bear"
    : "text-text-mute";
  return <span className={`text-[10px] ${color}`}>{status.replace(/_/g, " ")}</span>;
}
