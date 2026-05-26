"use client";

import Link from "next/link";

import type { Agent } from "@/lib/api";
import { PERSONALITY_ICON, ROLE_LABEL, STRATEGY_LABEL } from "@/lib/personality";

const FMT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

type Props = { agent: Agent; href: string };

export default function AgentCard({ agent, href }: Props) {
  const statusColor = agent.is_paused
    ? "text-warning"
    : agent.is_active
      ? "text-bull"
      : "text-text-mute";
  const statusLabel = agent.is_paused ? "paused" : agent.is_active ? "active" : "idle";

  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-border bg-bg-card p-5 transition hover:border-bull/50"
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-elev-2 text-lg">
          {agent.avatar_url ? (
            <img
              src={agent.avatar_url}
              alt={agent.name}
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <span>{agent.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{agent.name}</span>
            <span className="text-xs text-text-mute">{ROLE_LABEL[agent.role]}</span>
          </div>
          <div className="text-xs text-text-mute">
            {PERSONALITY_ICON[agent.personality]} {agent.personality}
          </div>
        </div>
        <span className={`text-[10px] uppercase tracking-widest ${statusColor}`}>
          ●&nbsp;{statusLabel}
        </span>
      </div>

      <div className="mb-3 text-xs text-text-dim">{agent.llm_model}</div>

      {agent.strategies.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {agent.strategies.map((s) => (
            <span
              key={s}
              className="rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-dim"
            >
              {STRATEGY_LABEL[s] ?? s}
            </span>
          ))}
        </div>
      )}

      <div className="mt-auto grid grid-cols-2 gap-2 text-xs">
        <Stat label="Allocation" value={FMT.format(agent.allocated_balance_usd)} />
        <Stat label="Max position" value={FMT.format(agent.max_position_size_usd)} />
        <Stat label="Kelly" value={agent.kelly_fraction.toFixed(2)} />
        <Stat
          label="Trades/day"
          value={String(agent.max_trades_per_day)}
        />
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-elev-1 px-2 py-1.5">
      <div className="text-text-mute">{label}</div>
      <div className="num text-text">{value}</div>
    </div>
  );
}
