"use client";

import { useEffect, useMemo, useState } from "react";

import { api, ApiError, type TradeIntent } from "@/lib/api";
import { friendlySymbol } from "@/lib/symbols";
import SymbolIcon from "@/components/SymbolIcon";

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
  /** Company id — required so the panel can hit POST /intents/{id}/close. */
  companyId: string;
  /** Called after a successful manual close so the parent can refresh its
   *  intent list right away rather than waiting for the next poll. */
  onIntentClosed?: (intentId: string, pnl: number) => void;
};

/** Agent-grouped roll-up. Each card shows total P&L (green/red) plus a
 *  collapsible list of its currently-open positions. Clicking a position
 *  bubbles up so the parent can switch the chart's symbol + highlight. */
export default function AgentsPanel({
  intents, livePrices, selectedIntentId, onPickIntent,
  companyId, onIntentClosed,
}: Props) {
  const buckets = useMemo(() => groupByAgent(intents, livePrices), [intents, livePrices]);
  // Per-agent daily target — fetched lazily so the panel still renders
  // instantly. The map is keyed by agentId; missing entries just mean
  // "no target" and the goal strip won't render for that agent.
  const [targets, setTargets] = useState<Record<string, number | null>>({});
  useEffect(() => {
    let cancelled = false;
    api.listAgents(companyId).then((r) => {
      if (cancelled) return;
      const map: Record<string, number | null> = {};
      for (const a of r.agents) map[a.id] = a.daily_profit_target_usd;
      setTargets(map);
    }).catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [companyId]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Expand by default the agent with open positions; collapse the rest.
    const s = new Set<string>();
    for (const b of buckets) if (b.open.length > 0) s.add(b.agentId);
    return s;
  });
  // Tracks which intent ids have an in-flight close so we can disable the
  // button + show a spinner. A simple Set is enough — closes are rare.
  const [closing, setClosing] = useState<Set<string>>(new Set());
  // Surface close errors inline on the row that produced them so the user
  // sees broker reasons like "ContractAlreadySold" without a toast system.
  const [closeError, setCloseError] = useState<Record<string, string>>({});

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function closePosition(intent: TradeIntent) {
    const id = intent.id;
    setCloseError((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setClosing((prev) => new Set(prev).add(id));
    try {
      const r = await api.closeIntent(companyId, id);
      onIntentClosed?.(id, r.realized_pnl_usd);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "close failed";
      setCloseError((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setClosing((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
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
            target={targets[b.agentId] ?? null}
            livePrices={livePrices}
            open={expanded.has(b.agentId)}
            onToggle={() => toggle(b.agentId)}
            selectedIntentId={selectedIntentId}
            onPickIntent={onPickIntent}
            onClosePosition={closePosition}
            closing={closing}
            closeError={closeError}
          />
        ))}
      </div>
    </section>
  );
}

function AgentCard({
  bucket, target, livePrices, open, onToggle, selectedIntentId, onPickIntent,
  onClosePosition, closing, closeError,
}: {
  bucket: AgentBucket;
  target: number | null;
  livePrices: LivePrices;
  open: boolean;
  onToggle: () => void;
  selectedIntentId: string | null;
  onPickIntent: (i: TradeIntent) => void;
  onClosePosition: (i: TradeIntent) => void;
  closing: Set<string>;
  closeError: Record<string, string>;
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

      {target != null && target > 0 && (
        <GoalStrip pnl={bucket.pnlToday} target={target} />
      )}

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
                  onClose={() => onClosePosition(p)}
                  closing={closing.has(p.id)}
                  closeError={closeError[p.id]}
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

function GoalStrip({ pnl, target }: { pnl: number; target: number }) {
  // Mirrors the dashboard's band logic so the strip color matches what
  // the decision-loop throttle is actually doing right now.
  const raw = pnl / target;
  const band =
    raw >= 1.0 ? "hit"
    : raw >= 0.8 ? "halve"
    : raw >= 0.5 ? "trim"
    : raw < 0 ? "red"
    : "normal";
  const barCls = {
    hit:    "bg-bull",
    halve:  "bg-amber-400",
    trim:   "bg-accent",
    normal: "bg-accent/60",
    red:    "bg-bear",
  }[band];
  const tone = {
    hit: "text-bull", halve: "text-amber-400", trim: "text-accent",
    normal: "text-text-mute", red: "text-bear",
  }[band];
  return (
    <div className="border-t border-border px-3 py-1.5">
      <div className="mb-1 flex items-baseline justify-between text-[10px] text-text-mute">
        <span>Goal</span>
        <span className={`num ${tone}`}>
          {pnl >= 0 ? "+" : ""}{FMT_USD.format(pnl)} / {FMT_USD.format(target)}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-bg-elev-2">
        <div
          className={`h-full transition-all ${barCls}`}
          style={{ width: `${Math.min(100, Math.max(0, raw * 100))}%` }}
        />
      </div>
    </div>
  );
}

function PositionRow({
  intent, livePrice, selected, onClick, onClose, closing, closeError,
}: {
  intent: TradeIntent;
  livePrice: number | null;
  selected: boolean;
  onClick: () => void;
  onClose: () => void;
  closing: boolean;
  closeError?: string;
}) {
  const unrealized = computeUnrealized(intent, livePrice);
  const tone = unrealized == null
    ? "text-text-mute"
    : unrealized > 0 ? "text-bull"
    : unrealized < 0 ? "text-bear"
    : "text-text-mute";
  const glyph = intent.direction === "up" ? "▲" : intent.direction === "down" ? "▼" : "●";
  const glyphTone = intent.direction === "up" ? "text-bull" : intent.direction === "down" ? "text-bear" : "text-text-mute";
  // The Close action gets its own button — but we want the whole row to
  // remain clickable for chart-switching. The trick is putting the row
  // contents in a <button> and the Close action in a sibling <button>
  // positioned absolutely. A button-in-button is invalid HTML.
  return (
    <li>
      <div
        className={`relative rounded-md border transition ${
          selected
            ? "border-accent/60 bg-accent-soft"
            : "border-transparent hover:border-border hover:bg-bg-elev-2"
        }`}
      >
        <button
          type="button"
          onClick={onClick}
          className="block w-full rounded-md px-2 py-1.5 pr-16 text-left text-xs"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 truncate">
              <span className={glyphTone}>{glyph}</span>
              <SymbolIcon code={intent.asset} size={14} />
              <span className="truncate text-text" title={intent.asset}>{friendlySymbol(intent.asset)}</span>
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
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          disabled={closing}
          title={`Close this position at market${unrealized != null ? ` (currently ${unrealized >= 0 ? "+" : ""}${FMT_USD.format(unrealized)})` : ""}`}
          className="absolute right-2 top-1.5 rounded-md border border-border bg-bg-elev-1 px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-dim transition hover:border-bear/40 hover:text-bear disabled:cursor-progress disabled:opacity-50"
        >
          {closing ? "…" : "Close"}
        </button>
        {closeError && (
          <div className="px-2 pb-1.5 text-[10px] text-bear">{closeError}</div>
        )}
      </div>
    </li>
  );
}

/** Unrealized P&L for a single open intent. For Deriv multipliers the broker
 *  formula is `stake × multiplier × (price_return × direction)` — so we MUST
 *  multiply by `multiplier`, otherwise a +0.01% tick on a 300× contract
 *  shows up as 1/300th of the true value (which was the bug the user spotted:
 *  per-row P&L coming back as $0.03 when broker had it at ~$9).
 *  Stops/targets are still broker-side; we only show the price-derived figure
 *  as a hint between ticks. */
export function computeUnrealized(intent: TradeIntent, livePrice: number | null): number | null {
  if (livePrice == null || intent.entry_price <= 0) return null;
  const sign = intent.direction === "up" ? 1 : intent.direction === "down" ? -1 : 0;
  if (sign === 0) return null;
  const mult = intent.multiplier ?? 1;
  const ret = (livePrice - intent.entry_price) / intent.entry_price;
  return ret * sign * intent.stake_usd * mult;
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
    const createdToday = i.created_at.startsWith(today);
    if (createdToday) b.intentsToday.push(i);

    const isOpen = i.status === "executed" && i.closed_at == null;
    if (isOpen) {
      b.open.push(i);
      const u = computeUnrealized(i, livePrices[i.asset] ?? null);
      if (u != null) b.unrealized += u;
    }
    // Realized "today" is keyed on closed_at, not created_at — a contract
    // opened yesterday and closed this morning still belongs to today's
    // P&L. Matches what the dashboard card now shows; the two stayed in
    // sync the moment we both keyed off closed_at.
    if (i.closed_at && i.closed_at.startsWith(today)) {
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
