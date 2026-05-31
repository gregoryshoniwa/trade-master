"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { api, type MeetingSummary } from "@/lib/api";

const FMT_REL = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

/** Compact pointer to the most recent meeting affecting this agent.
 *
 * When `agentId` is set, finds the most recent meeting where the agent
 * is the employee. When the agent is a manager, finds the most recent
 * action by them (the API returns mixed kinds, we filter client-side). */
export default function LastMeetingBadge({
  companyId, agentId, isManager,
}: {
  companyId: string;
  agentId: string;
  isManager: boolean;
}) {
  const [latest, setLatest] = useState<MeetingSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listMeetings(companyId, { limit: 50 }).then((page) => {
      if (cancelled) return;
      // Manager profile: latest meeting they ran.
      // Employee profile: latest meeting/review they were in.
      const match = isManager
        ? page.items.find((m) => m.kind === "review" || m.employee_name !== null)
        : page.items.find((m) => m.kind === "meeting" && m.employee_agent_id === agentId);
      setLatest(match ?? null);
    }).catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [companyId, agentId, isManager]);

  if (!latest) {
    return (
      <span className="text-xs text-text-mute">No meetings yet</span>
    );
  }
  const label = latest.kind === "meeting"
    ? `Last 1:1 ${latest.employee_name ? `with ${latest.employee_name}` : ""}`.trim()
    : `Last team review`;
  return (
    <Link
      href={`/meetings/${latest.id}`}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-elev-1 px-2 py-0.5 text-[10px] text-text-dim hover:border-accent/40 hover:text-text"
      title={new Date(latest.created_at).toLocaleString()}
    >
      <span>{label}</span>
      <span className="text-text-mute">· {FMT_REL(latest.created_at)}</span>
    </Link>
  );
}
