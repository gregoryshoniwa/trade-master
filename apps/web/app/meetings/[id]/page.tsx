"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError, type MeetingDetail, type MeetingTurn } from "@/lib/api";
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
        <h1 className="mt-1 text-xl font-semibold">{title}</h1>
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
            {meeting.narrative}
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
  // Tool-result content is JSON; show it as code. Everything else as text.
  const isToolResult = t.role === "tool";
  return (
    <div className={`rounded-lg border px-3 py-2 ${roleStyle(t.role)}`}>
      <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-widest text-text-mute">
        <span>{roleLabel(t.role)}</span>
        <span title={t.created_at}>{FMT_TIME.format(new Date(t.created_at))}</span>
      </div>
      {t.content && (
        isToolResult ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-bg-elev-2 p-2 text-[11px] font-mono text-text-dim">
            {t.content.length > 1200 ? t.content.slice(0, 1200) + "…" : t.content}
          </pre>
        ) : (
          <div className="whitespace-pre-line text-sm">{t.content}</div>
        )
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
