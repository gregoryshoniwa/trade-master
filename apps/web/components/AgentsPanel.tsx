"use client";

import { useMemo, useState } from "react";

import type { TradeIntent } from "@/lib/api";

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

type AgentBucket = {
  agentId: string;
  agentName: string;
  open: TradeIntent[];
  closedToday: TradeIntent[];
  intentsToday: TradeIntent[];
  pnlToday: number;
  // unrealized P&L for open positions, given the live latest price per symbol.
  unrealized: number;
};

type LivePrices = Record<string, number>;

type Props = {
  intents: TradeIntent[];
  livePrices: LivePrices;
  selectedIntentId: string | null;
  onPickIntent: (intent: TradeIntent) => void;
};

/** Agent-grouped roll-up. Each card shows total P&L (green/red) plus a
 *  collapsible list of its currently-open positions. Clicking a position
 *  bubbles up so the parent can switch the chart's symbol + highlight. */
export default function AgentsPanel({ intents, livePrices, selectedIntentId, onPickIntent }: Props) {
  const buckets = useMemo(() => groupByAgent(intents, livePrices), [intents, livePrices]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expand by default the agent with open positions; collapse the rest.
    const s = new Set<string>();
    for (const b of buckets) if (b.open.length > 0) s.add(b.agentId);
    return s;
  });

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (buckets.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-bg-card p-4">
        <h2 className="text-xs uppercase tracking-widest text-text-mute">Agents</h2>
        <p className="mt-2 text-xs text-text-mute">No agent activity yet today.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-xs uppercase tracking-widest text-text-mute">Agents</h2>
        <span className="num text-xs text-text-mute">
          {buckets.reduce((s, b) => s + b.open.length, 0)} open
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {buckets.map((b) => (
          <AgentCard
            key={b.agentId}
            bucket={b}
            livePrices={livePrices}
            open={expanded.has(b.agentId)}
            onToggle={() => toggle(b.agentId)}
            selectedIntentId={selectedIntentId}
            onPickIntent={onPickIntent}
          />
        ))}
      </div>
    </section>
  );
}

function AgentCard({
  bucket, livePrices, open, onToggle, selectedIntentId, onPickIntent,
}: {
  bucket: AgentBucket;
  livePrices: LivePrices;
  open: boolean;
  onToggle: () => void;
  selectedIntentId: string | null;
  onPickIntent: (i: TradeIntent) => void;
}) {
  const netPnl = bucket.pnlToday + bucket.unrealized;
  const tone =
    netPnl > 0.01 ? "text-bull"
    : netPnl < -0.01 ? "text-bear"
    : "text-text-mute";

  return (
    <article className="rounded-xl border border-border bg-bg-elev-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-bg-elev-2"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}
            aria-hidden
          >▶</span>
          <span className="truncate text-sm font-medium">{bucket.agentName}</span>
          <span className="num text-[10px] text-text-mute">
            {bucket.open.length} open · {bucket.intentsToday.length} today
          </span>
        </div>
        <span className={`num text-sm font-medium ${tone}`}>
          {netPnl >= 0 ? "+" : ""}{FMT_USD.format(netPnl)}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-2 pb-2 pt-1">
          {bucket.open.length === 0 ? (
            <p className="px-1 py-2 text-xs text-text-mute">No open positions.</p>
          ) : (
            <ul className="space-y-1">
              {bucket.open.map((p) => (
                <PositionRow
                  key={p.id}
                  intent={p}
                  livePrice={livePrices[p.asset] ?? null}
                  selected={p.id === selectedIntentId}
                  onClick={() => onPickIntent(p)}
                />
              ))}
            </ul>
          )}
          {bucket.pnlToday !== 0 && (
            <div className="mt-2 flex items-baseline justify-between px-1 text-[11px] text-text-mute">
              <span>Realized today</span>
              <span className={`num ${bucket.pnlToday >= 0 ? "text-bull" : "text-bear"}`}>
                {bucket.pnlToday >= 0 ? "+" : ""}{FMT_USD.format(bucket.pnlToday)}
              </span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function PositionRow({
  intent, livePrice, selected, onClick,
}: {
  intent: TradeIntent;
  livePrice: number | null;
  selected: boolean;
  onClick: () => void;
}) {
  const sign = intent.direction === "up" ? 1 : intent.direction === "down" ? -1 : 0;
  // Simple unrealized = (live - entry) * direction * stake (price-return scaling
  // — exact Deriv multiplier P&L is broker-side; this is a visual indicator).
  const unrealized = livePrice != null && intent.entry_price > 0
    ? ((livePrice - intent.entry_price) / intent.entry_price) * sign * intent.stake_usd
    : null;
  const tone = unrealized == null
    ? "text-text-mute"
    : unrealized > 0 ? "text-bull"
    : unrealized < 0 ? "text-bear"
    : "text-text-mute";
  const glyph = intent.direction === "up" ? "▲" : intent.direction === "down" ? "▼" : "●";
  const glyphTone = intent.direction === "up" ? "text-bull" : intent.direction === "down" ? "text-bear" : "text-text-mute";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${
          selected
            ? "border-accent/60 bg-accent-soft"
            : "border-transparent hover:border-border hover:bg-bg-elev-2"
        }`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex items-baseline gap-1 truncate">
            <span className={glyphTone}>{glyph}</span>
            <span className="num text-text">{intent.asset}</span>
            <span className="num text-[10px] text-text-mute">
              {intent.contract_type}
            </span>
          </span>
          {unrealized != null ? (
            <span className={`num ${tone}`}>
              {unrealized >= 0 ? "+" : ""}{FMT_USD.format(unrealized)}
            </span>
          ) : (
            <span className="num text-text-mute">{FMT_USD.format(intent.stake_usd)}</span>
          )}
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-text-mute">
          <span>entry <span className="num text-text">{FMT_PRICE.format(intent.entry_price)}</span></span>
          <span>stop <span className="num text-bear">{intent.stop_loss != null ? FMT_PRICE.format(intent.stop_loss) : "—"}</span></span>
          <span>tgt <span className="num text-bull">{intent.take_profit != null ? FMT_PRICE.format(intent.take_profit) : "—"}</span></span>
        </div>
      </button>
    </li>
  );
}

/** Roll up intents into per-agent buckets. `livePrices` keys on asset symbol
 *  and provides the current quote — used for the unrealized-P&L hint. */
function groupByAgent(intents: TradeIntent[], livePrices: LivePrices): AgentBucket[] {
  const today = new Date().toISOString().slice(0, 10);
  const byAgent = new Map<string, AgentBucket>();

  for (const i of intents) {
    let b = byAgent.get(i.agent_id);
    if (!b) {
      b = {
        agentId: i.agent_id,
        agentName: i.agent_name,
        open: [],
        closedToday: [],
        intentsToday: [],
        pnlToday: 0,
        unrealized: 0,
      };
      byAgent.set(i.agent_id, b);
    }
    const isToday = i.created_at.startsWith(today);
    if (isToday) b.intentsToday.push(i);

    const isOpen = i.status === "executed" && i.closed_at == null;
    if (isOpen) {
      b.open.push(i);
      const live = livePrices[i.asset];
      const sign = i.direction === "up" ? 1 : i.direction === "down" ? -1 : 0;
      if (live != null && i.entry_price > 0) {
        b.unrealized += ((live - i.entry_price) / i.entry_price) * sign * i.stake_usd;
      }
    }
    if (i.closed_at && isToday) {
      b.closedToday.push(i);
      if (i.realized_pnl_usd != null) b.pnlToday += i.realized_pnl_usd;
    }
  }

  // Sort: agents with open positions first, then by realized-today P&L desc.
  return [...byAgent.values()].sort((a, b) => {
    if ((a.open.length > 0) !== (b.open.length > 0)) return a.open.length > 0 ? -1 : 1;
    return (b.pnlToday + b.unrealized) - (a.pnlToday + a.unrealized);
  });
}
