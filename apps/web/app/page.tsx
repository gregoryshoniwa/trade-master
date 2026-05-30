"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import AgentsPanel, { computeUnrealized } from "@/components/AgentsPanel";
import AssetPicker from "@/components/AssetPicker";
import DailySummary from "@/components/DailySummary";
import GoalProgress from "@/components/GoalProgress";
import KillSwitch from "@/components/KillSwitch";
import SafetyBadges from "@/components/SafetyBadges";
import TickChart from "@/components/TickChart";
import { api, type SymbolDef, type TradeIntent } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { firstSymbol, friendlySymbol } from "@/lib/symbols";

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
  // Defensive: someone may set NEXT_PUBLIC_DEFAULT_SYMBOL to the same
  // comma-list as the gateway's DERIV_DEFAULT_SYMBOL. Take the first entry.
  const envSymbol = firstSymbol(process.env.NEXT_PUBLIC_DEFAULT_SYMBOL, FALLBACK_SYMBOL);

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

  // Restore symbol choice when active company changes. Defensive: a previous
  // build may have stored a comma-list here (the gateway's subscription list
  // got mis-baked as the web default). Always take the first entry.
  useEffect(() => {
    const stored = localStorage.getItem(activeSymbolKey(activeCompanyId));
    if (stored) setSymbol(firstSymbol(stored, FALLBACK_SYMBOL));
  }, [activeCompanyId]);

  // Lookup display metadata for the current symbol.
  useEffect(() => {
    api.listSymbols().then((r) => {
      setSymbolMeta(r.symbols.find((s) => s.code === symbol) ?? null);
    });
  }, [symbol]);

  // Poll recent intents to drive the chart overlays + rail panels. We
  // fetch TWO lists and merge them: "all" gives us the latest 100 events
  // (most of which are closed/failed — they're what the chart history
  // needs) and "open" guarantees every still-open position surfaces, even
  // if it was opened yesterday and is buried under recent rejections.
  // Without the second list the agents rail showed 0 open while the
  // broker held 78 contracts (the gap the user spotted).
  const refreshIntents = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const [recent, open] = await Promise.all([
        api.listIntents(activeCompanyId, "all", 100),
        api.listIntents(activeCompanyId, "open", 200),
      ]);
      const seen = new Set<string>();
      const merged: typeof recent.intents = [];
      for (const i of [...open.intents, ...recent.intents]) {
        if (seen.has(i.id)) continue;
        seen.add(i.id);
        merged.push(i);
      }
      // Newest first so the chart and rail share the same ordering.
      merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setIntents(merged);
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
  // "Today's realized" = P&L from contracts that CLOSED today, not from
  // intents created today. A position opened yesterday and closed this
  // morning counts here. The old version filtered on created_at which
  // hid yesterday-opened-today-closed P&L and double-counted same-day
  // opens regardless of whether they'd actually settled.
  const todayPnl = useMemo(
    () => intents
      .filter((i) => i.closed_at != null && i.closed_at.startsWith(today))
      .reduce((sum, i) => sum + (i.realized_pnl_usd ?? 0), 0),
    [intents, today],
  );
  // Unrealized must use the same multiplier-aware math as PositionRow,
  // otherwise the rail and the header card disagree. Shared helper avoids
  // drift — the dashboard previously dropped the multiplier here and
  // showed $0.30 across 10 contracts when the broker had it at ~$50.
  const unrealizedPnl = useMemo(() => {
    let sum = 0;
    for (const p of openPositions) {
      const u = computeUnrealized(p, livePrices[p.asset] ?? null);
      if (u != null) sum += u;
    }
    return sum;
  }, [openPositions, livePrices]);
  const symbolIntents = useMemo(
    () => intents.filter((i) => i.asset === symbol).slice(0, 50),
    [intents, symbol],
  );

  // The Shell handles the logged-out redirect to /login centrally, so we
  // don't need to render an inline landing here. By the time this point is
  // reached the Shell has already established that the user is signed in.

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
          {active && <SafetyBadges companyId={active.id} />}
          {active && <KillSwitch companyId={active.id} />}
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

      {/* Goal progress strip — hidden when no target set. */}
      {active && <GoalProgress companyId={active.id} todayRealizedUsd={todayPnl} />}

      {/* Daily summary — hidden when there's nothing to show. */}
      {active && <DailySummary companyId={active.id} />}

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
          value={symbolMeta?.display ?? friendlySymbol(symbol)}
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
            displayName={symbolMeta?.display ?? friendlySymbol(symbol)}
            intents={symbolIntents}
            highlightedIntentId={selectedIntentId}
          />
        </div>
        <div className="flex flex-col gap-4">
          {active && (
            <AgentsPanel
              intents={intents}
              livePrices={livePrices}
              selectedIntentId={selectedIntentId}
              onPickIntent={onPickIntent}
              companyId={active.id}
              onIntentClosed={() => {
                // Pull fresh state now so the closed row disappears
                // immediately instead of after the next 5s poll.
                refreshIntents();
              }}
            />
          )}
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
    <div className="min-w-0 rounded-2xl border border-border bg-bg-card p-4">
      <div className="truncate text-xs uppercase tracking-widest text-text-mute">{label}</div>
      <div className={`num mt-1 truncate text-2xl font-medium ${toneCls}`} title={value}>{value}</div>
      {sub && <div className="truncate text-xs text-text-mute">{sub}</div>}
    </div>
  );
}
