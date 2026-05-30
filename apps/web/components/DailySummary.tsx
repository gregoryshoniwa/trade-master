"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  api,
  type EmployeeMeetingRequest,
  type ManagerAction,
} from "@/lib/api";

const FMT_USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const FMT_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit", minute: "2-digit", hour12: false,
});

type Props = {
  companyId: string;
};

/** Single-glance "what happened today on the agentic side".
 *
 * Three things in one tile:
 *   - what the manager changed (adjustments, pauses)
 *   - what employees are asking for (pending meeting requests)
 *   - the most recent meeting (if any) — with a link to the transcript
 *
 * Hidden if all three are empty, so quiet days don't waste space. */
export default function DailySummary({ companyId }: Props) {
  const [actions, setActions] = useState<ManagerAction[]>([]);
  const [requests, setRequests] = useState<EmployeeMeetingRequest[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [acts, reqs] = await Promise.all([
          api.listManagerActions(companyId, { limit: 50 }),
          api.listEmployeeRequests(companyId),
        ]);
        if (cancelled) return;
        setActions(acts.actions);
        setRequests(reqs);
      } catch { /* silent — peripheral feature */ }
    }
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [companyId]);

  // Today's local midnight in ISO — the API returns UTC strings so we
  // do a permissive comparison via Date objects rather than substring.
  const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
  const todayActions = actions.filter((a) => new Date(a.created_at) >= todayMidnight);
  const adjustments = todayActions.filter((a) => a.action_kind === "adjust");
  const pauses = todayActions.filter((a) => a.action_kind === "pause");
  const meetings = todayActions.filter((a) => a.action_kind === "meeting" || a.action_kind === "review");
  const pendingReqs = requests.filter((r) => r.status === "pending");

  const empty = adjustments.length === 0 && pauses.length === 0
    && meetings.length === 0 && pendingReqs.length === 0;
  if (empty) return null;

  const lastMeeting = meetings[0] ?? null;

  return (
    <div className="mb-4 rounded-2xl border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-mute">
          Today on the team
        </span>
        <Link href="/meetings" className="text-[10px] text-accent hover:underline">
          full feed →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Manager adjustments"
          value={adjustments.length === 0 ? "—" : String(adjustments.length)}
          tone={adjustments.length > 0 ? "accent" : "muted"}
          sub={adjustments[0] ? adjustmentLine(adjustments[0]) : "no changes"}
        />
        <Tile
          label="Pending requests"
          value={pendingReqs.length === 0 ? "—" : String(pendingReqs.length)}
          tone={pendingReqs.length > 0 ? "amber" : "muted"}
          sub={pendingReqs[0] ? `${pendingReqs[0].employee_name}: ${truncate(pendingReqs[0].reason, 60)}` : "queue empty"}
        />
        <Tile
          label={lastMeeting ? "Last meeting" : "Meetings today"}
          value={lastMeeting ? FMT_TIME.format(new Date(lastMeeting.created_at)) : "—"}
          tone="muted"
          sub={lastMeeting ? meetingLine(lastMeeting) : "none yet"}
          link={lastMeeting ? `/meetings/${lastMeeting.id}` : undefined}
        />
      </div>
      {pauses.length > 0 && (
        <div className="mt-3 rounded-md border border-bear/30 bg-bear-soft/30 p-2 text-xs text-bear">
          ⚠ Manager paused {pauses.length === 1 ? "1 employee" : `${pauses.length} employees`} today
          {pauses[0].employee_name && ` — ${pauses[0].employee_name}: ${pauses[0].reason ?? "(no reason)"}`}
        </div>
      )}
    </div>
  );
}

function Tile({
  label, value, sub, tone, link,
}: {
  label: string; value: string; sub: string;
  tone: "muted" | "accent" | "amber"; link?: string;
}) {
  const cls = {
    muted: "text-text",
    accent: "text-accent",
    amber: "text-amber-400",
  }[tone];
  const Wrapper: React.FC<{ children: React.ReactNode }> = link
    ? ({ children }) => <Link href={link}>{children}</Link>
    : ({ children }) => <div>{children}</div>;
  return (
    <Wrapper>
      <div className="rounded-md bg-bg-elev-1 p-3 hover:bg-bg-elev-2">
        <div className="text-[10px] uppercase tracking-widest text-text-mute">{label}</div>
        <div className={`num mt-1 text-lg font-medium ${cls}`}>{value}</div>
        <div className="mt-1 line-clamp-2 text-[10px] text-text-mute">{sub}</div>
      </div>
    </Wrapper>
  );
}

function adjustmentLine(a: ManagerAction): string {
  if (!a.field_name) return a.reason ?? "adjustment";
  const before = formatVal(a.before_value);
  const after = formatVal(a.after_value);
  const who = a.employee_name ?? "agent";
  return `${who}: ${a.field_name} ${before} → ${after}`;
}

function meetingLine(m: ManagerAction): string {
  if (m.action_kind === "meeting" && m.employee_name) {
    return `1:1 with ${m.employee_name}`;
  }
  return "team review";
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

// Keep FMT_USD referenced even when not currently used in case the
// tile copy grows to include dollar amounts later.
void FMT_USD;
