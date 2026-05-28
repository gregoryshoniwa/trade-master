"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AgentsPanel from "@/components/AgentsPanel";
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

export default function DashboardPage() {
  // Fallback matches the dev compose stack's exposed gateway port (18080).
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:18080";
  const envSymbol = process.env.NEXT_PUBLIC_DEFAULT_SYMBOL ?? FALLBACK_SYMBOL;

  const { loading, me, companies, activeCompanyId } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [symbol, setSymbol] = useState<string>(envSymbol);
  const [symbolMeta, setSymbolMeta] = useState<SymbolDef | null>(null);
  const [intents, setIntents] = useState<TradeIntent[]>([]);
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);

  // Live prices keyed by symbol — updated by a slim WS subscription at the
  // page level so the AgentsPanel can compute per-position unrealized P&L
  // across symbols (not just the one the chart is showing).
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

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
      /* AuthProvider handles 401s; transient errors don't need UI */
    }
  }, [activeCompanyId]);

  useEffect(() => {
    refreshIntents();
    const t = setInterval(refreshIntents, 5000);
    return () => clearInterval(t);
  }, [refreshIntents]);

  // Live-prices WS — separate from the chart's WS so we capture ALL symbols,
  // not just the one the chart is rendering. Updates a per-symbol map at a
  // throttled cadence so React isn't re-rendering on every tick (~10/sec).
  const livePricesPendingRef = useRef<Record<string, number>>({});
  useEffect(() => {
    let ws: WebSocket | null = null;
    let cancelled = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (Object.keys(livePricesPendingRef.current).length === 0) return;
      setLivePrices((prev) => ({ ...prev, ...livePricesPendingRef.current }));
      livePricesPendingRef.current = {};
    };
    const flushTimer = setInterval(flush, 1000);

    const connect = () => {
      if (cancelled) return;
      ws = new WebSocket(`${wsUrl}/ws/ticks`);
      ws.onclose = () => {
        if (!cancelled) reconnect = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m?.type === "tick" && m.payload?.symbol) {
            livePricesPendingRef.current[m.payload.symbol] = m.payload.quote;
          }
        } catch { /* drop malformed */ }
      };
    };
    connect();

    return () => {
      cancelled = true;
      if (reconnect) clearTimeout(reconnect);
      clearInterval(flushTimer);
      ws?.close();
    };
  }, [wsUrl]);

  function chooseSymbol(code: string) {
    setSymbol(code);
    localStorage.setItem(activeSymbolKey(activeCompanyId), code);
  }

  function onPickIntent(i: TradeIntent) {
    setSelectedIntentId(i.id);
    if (i.asset !== symbol) chooseSymbol(i.asset);
  }

  // ── Derived data ────────────────────────────────────────────────────
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
    () => todays.reduce((sum, i) => sum + (i.realized_pnl_usd ?? 0), 0),
    [todays],
  );
  const unrealizedPnl = useMemo(() => {
    let sum = 0;
    for (const p of openPositions) {
      const live = livePrices[p.asset];
      if (live == null || p.entry_price <= 0) continue;
      const sign = p.direction === "up" ? 1 : p.direction === "down" ? -1 : 0;
      sum += ((live - p.entry_price) / p.entry_price) * sign * p.stake_usd;
    }
    return sum;
  }, [openPositions, livePrices]);
  const symbolIntents = useMemo(
    () => intents.filter((i) => i.asset === symbol).slice(0, 50),
    [intents, symbol],
  );

  // Unauthenticated / empty state
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
          label="Today's Realized"
          value={FMT_USD.format(todayPnl)}
          tone={todayPnl > 0 ? "bull" : todayPnl < 0 ? "bear" : "muted"}
        />
        <StatCard
          label="Unrealized (open)"
          value={FMT_USD.format(unrealizedPnl)}
          tone={unrealizedPnl > 0 ? "bull" : unrealizedPnl < 0 ? "bear" : "muted"}
          sub={`${openPositions.length} positions`}
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

      {/* Main: chart + agents rail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <TickChart
            symbol={symbol}
            wsUrl={`${wsUrl}/ws/ticks`}
            decimals={symbolMeta?.decimals ?? 4}
            displayName={symbolMeta?.display}
            intents={symbolIntents}
            highlightedIntentId={selectedIntentId}
          />
        </div>
        <div className="flex flex-col gap-4">
          <AgentsPanel
            intents={intents}
            livePrices={livePrices}
            selectedIntentId={selectedIntentId}
            onPickIntent={onPickIntent}
          />
        </div>
      </div>
    </div>
  );
}

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
