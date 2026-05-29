"use client";

import { useEffect, useRef, useState } from "react";

import { api, ApiError, type AgentActivityEvent } from "@/lib/api";

const POLL_MS = 5_000;

const FMT_TIME = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const FMT_DAY = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric",
});

function relativeFromNow(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return FMT_DAY.format(new Date(iso));
}

function toneClass(tone: AgentActivityEvent["tone"]): string {
  if (tone === "bull") return "border-bull/30 bg-bull-soft/30";
  if (tone === "bear") return "border-bear/30 bg-bear-soft/30";
  if (tone === "accent") return "border-accent/30 bg-bg-elev-1";
  return "border-border bg-bg-elev-1";
}

function kindGlyph(kind: AgentActivityEvent["kind"]): string {
  switch (kind) {
    case "intent_opened":    return "•";
    case "intent_executed":  return "▶";
    case "intent_closed":    return "■";
    case "intent_rejected":  return "✕";
    case "manager_action":   return "⚙";
    case "chat_message":     return "💬";
  }
}

export default function AgentActivityFeed({
  companyId, agentId,
}: { companyId: string; agentId: string }) {
  const [events, setEvents] = useState<AgentActivityEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lastTopTs = useRef<string | null>(null);
  const [newCount, setNewCount] = useState(0);

  // Re-render the "Xs ago" labels every 10 seconds even when no new
  // events landed.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  // Pin "now" reference so the linter doesn't strip the effect.
  void now;

  async function refresh() {
    try {
      setLoading(true);
      setError(null);
      const r = await api.getAgentActivity(companyId, agentId, 50);
      // Count how many new entries arrived since last poll — used to
      // show a small "+3 new" pulse so the user notices when the feed
      // is live.
      if (lastTopTs.current && r.events.length > 0) {
        const added = r.events.findIndex((e) => e.ts === lastTopTs.current);
        if (added > 0) setNewCount((n) => n + added);
      }
      if (r.events.length > 0) {
        lastTopTs.current = r.events[0].ts;
      }
      setEvents(r.events);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, agentId]);

  if (error) {
    return <div className="text-sm text-text-mute">Couldn't load activity: {error}</div>;
  }
  if (events === null) {
    return <div className="text-sm text-text-mute">Loading…</div>;
  }
  if (events.length === 0) {
    return <div className="text-sm text-text-mute">No recent activity yet.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-widest text-text-mute">
        <span>
          live · polling every {POLL_MS / 1000}s
          {loading && <span className="ml-1 animate-pulse text-accent">●</span>}
        </span>
        {newCount > 0 && (
          <button
            type="button"
            onClick={() => setNewCount(0)}
            className="rounded-full bg-accent/20 px-2 py-0.5 text-accent"
          >
            +{newCount} new
          </button>
        )}
      </div>
      <ol className="space-y-2">
        {events.map((e, idx) => (
          <li
            key={`${e.ts}-${e.kind}-${idx}`}
            className={`rounded-lg border px-3 py-2 ${toneClass(e.tone)}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="text-text-mute">{kindGlyph(e.kind)}</span>
                <span className="truncate text-sm">{e.title}</span>
              </div>
              <span
                className="shrink-0 text-[10px] text-text-mute"
                title={new Date(e.ts).toISOString()}
              >
                {relativeFromNow(e.ts)} · {FMT_TIME.format(new Date(e.ts))}
              </span>
            </div>
            {e.detail && (
              <div className="mt-1 line-clamp-2 text-xs text-text-mute">
                {e.detail}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
