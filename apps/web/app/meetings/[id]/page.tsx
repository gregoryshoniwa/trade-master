"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import SymbolText from "@/components/SymbolText";
import VoiceModal from "@/components/VoiceModal";
import { api, ApiError, type Agent, type MeetingDetail, type MeetingTurn } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FMT_DT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});
const FMT_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

function roleStyle(role: string): string {
  if (role === "assistant") return "border-accent/30 bg-bg-elev-1";
  if (role === "user") return "border-bull/30 bg-bull-soft/20";
  if (role === "tool") return "border-border bg-bg-elev-2";
  return "border-border bg-bg-card";
}

function roleLabel(role: string): string {
  if (role === "assistant") return "Manager";
  if (role === "user") return "Agenda from CEO";
  if (role === "tool") return "Tool result";
  return role;
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompanyId || !params.id) return;
    api.getMeeting(activeCompanyId, params.id)
      .then(setMeeting)
      .catch((e) => setError(e instanceof ApiError ? e.message : "load failed"));
  }, [activeCompanyId, params.id]);

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <Link href="/login" className="text-bull">Sign in</Link>
      </main>
    );
  }
  if (!active) {
    return <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">Select or create a company first.</main>;
  }
  if (error) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <p className="mb-3 text-sm text-bear">{error}</p>
        <Link href="/meetings" className="text-sm text-bull">← Back to meetings</Link>
      </main>
    );
  }
  if (!meeting) {
    return <main className="px-6 py-8 text-sm text-text-mute">Loading meeting…</main>;
  }

  const isOneOnOne = meeting.kind === "meeting";
  const title = isOneOnOne
    ? `1:1 — ${meeting.manager_name ?? "manager"} with ${meeting.employee_name ?? "employee"}`
    : `Team review by ${meeting.manager_name ?? "manager"}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-4">
        <Link href="/meetings" className="text-xs text-text-mute hover:text-text">
          ← All meetings
        </Link>
      </div>

      <header className="mb-6">
        <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-widest text-text-mute">
          <span className={isOneOnOne ? "text-accent" : "text-text-mute"}>
            {isOneOnOne ? "1:1 meeting" : "Scheduled team review"}
          </span>
          <span>·</span>
          <span>{FMT_DT.format(new Date(meeting.created_at))}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-xl font-semibold">{title}</h1>
          {meeting.manager_agent_id && activeCompanyId && (
            <CallManagerButton
              companyId={activeCompanyId}
              managerId={meeting.manager_agent_id}
              managerName={meeting.manager_name ?? "manager"}
            />
          )}
        </div>
        {meeting.agenda && (
          <p className="mt-2 rounded-lg bg-bg-elev-1 p-3 text-sm text-text-dim">
            <span className="text-text-mute">Agenda: </span>{meeting.agenda}
          </p>
        )}
      </header>

      {meeting.narrative && (
        <section className="mb-6 rounded-2xl border border-accent/30 bg-bg-card p-5">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-text-mute">
            Meeting notes
          </div>
          <div className="prose prose-invert max-w-none whitespace-pre-line text-sm">
            <SymbolText>{meeting.narrative}</SymbolText>
          </div>
        </section>
      )}

      {meeting.transcript.length > 0 ? (
        <section className="space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-text-mute">
            Full transcript ({meeting.transcript.length} turn{meeting.transcript.length === 1 ? "" : "s"})
          </div>
          {meeting.transcript.map((t, i) => <TurnCard key={i} t={t} />)}
        </section>
      ) : (
        !meeting.narrative && (
          <p className="text-sm text-text-mute">
            No transcript captured for this meeting (predates the persistence step).
          </p>
        )
      )}

      {meeting.transcript.length > 0 && activeCompanyId && (
        <FollowUpReply
          companyId={activeCompanyId}
          meetingId={meeting.id}
          onSent={() => {
            // Re-fetch shortly after the manager replies. The reply
            // runs in the background; 12s is a reasonable mid-point
            // between "manager just started" and "definitely done".
            setTimeout(() => {
              api.getMeeting(activeCompanyId, meeting.id).then(setMeeting).catch(() => { /* ignore */ });
            }, 12_000);
          }}
        />
      )}
    </main>
  );
}

function FollowUpReply({
  companyId, meetingId, onSent,
}: {
  companyId: string; meetingId: string; onSent: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  async function send() {
    const msg = text.trim();
    if (!msg) return;
    setBusy(true); setError(null);
    try {
      const r = await api.followUpOnMeeting(companyId, meetingId, msg);
      setSentNote(r.note ?? "manager is replying");
      setText("");
      onSent();
      setTimeout(() => setSentNote(null), 8_000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "send failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-2xl border border-bull/30 bg-bull-soft/20 p-4">
      <div className="mb-2 text-[10px] uppercase tracking-widest text-text-mute">
        Continue this meeting
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="e.g. Cut Kronny's allocation to $50. Also set the daily profit target to $25."
        className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-accent"
        disabled={busy}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[10px] text-text-mute">
          {sentNote && <span className="text-bull">{sentNote}</span>}
          {error && <span className="text-bear">{error}</span>}
        </span>
        <button
          type="button"
          onClick={send}
          disabled={busy || !text.trim()}
          className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </div>
    </section>
  );
}

function TurnCard({ t }: { t: MeetingTurn }) {
  const calls = Array.isArray(t.tool_calls) ? (t.tool_calls as Array<{ name?: string; arguments?: unknown }>) : [];
  const isToolResult = t.role === "tool";
  const toolName = isToolResult && calls[0]?.name ? String(calls[0].name) : null;
  return (
    <div className={`rounded-lg border px-3 py-2 ${roleStyle(t.role)}`}>
      <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-widest text-text-mute">
        <span>
          {roleLabel(t.role)}
          {toolName && <span className="ml-2 text-text-mute">· {toolName}</span>}
        </span>
        <span title={t.created_at}>{FMT_TIME.format(new Date(t.created_at))}</span>
      </div>
      {t.content && (
        isToolResult ? (
          <ToolResult name={toolName ?? ""} raw={t.content} />
        ) : null
      )}
      {t.content && !isToolResult && (
        <div className="whitespace-pre-line text-sm">
          <SymbolText>{t.content}</SymbolText>
        </div>
      )}
      {calls.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {calls.map((c, i) => (
            <span key={i} className="rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] text-accent">
              → {c.name ?? "tool"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inline button that loads the manager's full agent record on click,
 *  then opens the existing VoiceModal — same Gemini Live path the agent
 *  profile uses, just sourced from the meeting context. */
function CallManagerButton({
  companyId, managerId, managerName,
}: {
  companyId: string; managerId: string; managerName: string;
}) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!agent) {
      setBusy(true);
      try {
        const a = await api.getAgent(companyId, managerId);
        setAgent(a);
      } catch {
        setBusy(false);
        return;
      } finally {
        setBusy(false);
      }
    }
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="rounded-md border border-accent/40 px-3 py-1.5 text-sm text-accent hover:bg-accent/10 disabled:opacity-50"
        title={`Open voice call with ${managerName}`}
      >
        {busy ? "Loading…" : `📞 Call ${managerName}`}
      </button>
      {open && agent && (
        <VoiceModal
          open={open}
          agentName={agent.name}
          agentLlmLabel={`${agent.llm_provider}/${agent.llm_model}`}
          companyId={companyId}
          agentId={agent.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Dispatches tool results to a pretty renderer by name, falls back to
 *  collapsed raw JSON. Cheap to add new renderers later. */
function ToolResult({ name, raw }: { name: string; raw: string }) {
  let parsed: unknown = null;
  try { parsed = JSON.parse(raw); } catch { /* leave parsed null */ }

  if (parsed && typeof parsed === "object") {
    if (name === "web_search") return <WebSearchResult data={parsed as WebSearchPayload} />;
    if (name === "get_upcoming_economic_events") return <EconEventsResult data={parsed as EconEventsPayload} />;
    if (name === "get_team_status") return <TeamStatusResult data={parsed as TeamStatusPayload} />;
  }
  // Default: collapsed raw JSON.
  return <RawJson raw={raw} />;
}

function RawJson({ raw }: { raw: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-[10px] text-text-mute hover:text-text">View raw</summary>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-bg-elev-2 p-2 text-[11px] font-mono text-text-dim">
        {raw.length > 4000 ? raw.slice(0, 4000) + "…" : raw}
      </pre>
    </details>
  );
}

type WebSearchPayload = {
  ok?: boolean;
  query?: string;
  error?: string;
  quota_used_today?: number;
  quota_total?: number;
  results?: Array<{ title: string; url: string; snippet: string; domain: string }>;
};

function WebSearchResult({ data }: { data: WebSearchPayload }) {
  if (data.ok === false) {
    return <div className="text-xs text-bear">Search failed: {data.error}</div>;
  }
  const results = Array.isArray(data.results) ? data.results : [];
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-[10px] text-text-mute">
        <span className="num">"{data.query}"</span>
        {data.quota_used_today != null && (
          <span className="num">quota {data.quota_used_today}/{data.quota_total}</span>
        )}
      </div>
      {results.length === 0 ? (
        <div className="text-xs text-text-mute">No results.</div>
      ) : (
        <ul className="space-y-2">
          {results.map((r, i) => (
            <li key={i} className="rounded-md border border-border bg-bg-elev-1 p-2">
              <a
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs font-medium text-accent hover:underline"
              >
                {r.title || r.url}
              </a>
              <div className="text-[10px] text-text-mute">{r.domain || hostname(r.url)}</div>
              {r.snippet && (
                <p className="mt-1 line-clamp-3 text-xs text-text-dim">{r.snippet}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

type EconEventsPayload = {
  hours_ahead?: number;
  impact_filter?: string;
  asset_filter?: string | null;
  guidance?: string;
  events?: Array<{
    name: string; impact: string; currency: string;
    ts: string; minutes_until: number; affected_assets: string[];
  }>;
};

function EconEventsResult({ data }: { data: EconEventsPayload }) {
  const events = Array.isArray(data.events) ? data.events : [];
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-text-mute">
        next {data.hours_ahead}h · {data.impact_filter ?? "high"} impact
      </div>
      {events.length === 0 ? (
        <div className="text-xs text-text-mute">{data.guidance ?? "No events."}</div>
      ) : (
        <ul className="space-y-1">
          {events.map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-xs">
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] tracking-widest ${
                e.impact === "high" ? "bg-bear/15 text-bear"
                : e.impact === "medium" ? "bg-warning/15 text-warning"
                : "bg-bg-elev-2 text-text-mute"
              }`}>
                {e.impact.toUpperCase()}
              </span>
              <span className="num text-text-mute">{e.currency}</span>
              <span className="flex-1 truncate">{e.name}</span>
              <span className="num text-[10px] text-text-mute">
                in {Math.max(0, e.minutes_until)}m
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type TeamStatusPayload = {
  employees?: Array<{
    name: string;
    state?: { is_paused?: boolean };
    last_7d?: { n?: number; hit_rate?: number; pnl_usd?: number };
  }>;
};

function TeamStatusResult({ data }: { data: TeamStatusPayload }) {
  const emps = Array.isArray(data.employees) ? data.employees : [];
  if (emps.length === 0) return <RawJson raw={JSON.stringify(data)} />;
  return (
    <ul className="space-y-1">
      {emps.map((e, i) => {
        const stats = e.last_7d ?? {};
        const hit = stats.hit_rate;
        const pnl = stats.pnl_usd;
        return (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="w-20 truncate font-medium">{e.name}</span>
            {e.state?.is_paused && (
              <span className="rounded-full bg-bear-soft px-1.5 py-0.5 text-[9px] text-bear">paused</span>
            )}
            <span className="num text-text-mute">n={stats.n ?? 0}</span>
            {hit != null && (
              <span className={`num ${hit >= 0.52 ? "text-bull" : hit <= 0.48 ? "text-bear" : "text-text-mute"}`}>
                hit {(hit * 100).toFixed(1)}%
              </span>
            )}
            {pnl != null && (
              <span className={`num ml-auto ${pnl > 0 ? "text-bull" : pnl < 0 ? "text-bear" : "text-text-mute"}`}>
                {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
