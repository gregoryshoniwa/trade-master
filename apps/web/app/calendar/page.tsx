"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type EconomicEvent } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type ImpactFilter = "all" | "high" | "medium";

const IMPACT_COLOR: Record<EconomicEvent["impact"], string> = {
  high: "text-bear",
  medium: "text-warning",
  low: "text-text-mute",
};
const IMPACT_RING: Record<EconomicEvent["impact"], string> = {
  high: "border-bear/40",
  medium: "border-warning/40",
  low: "border-border",
};

export default function CalendarPage() {
  const { me, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<EconomicEvent[]>([]);
  const [impact, setImpact] = useState<ImpactFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.listEvents({ impact, horizonHours: 168, limit: 200 });
      setEvents(r.events);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [impact]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (authLoading) return <div className="px-6 py-8 text-sm text-text-mute">Loading…</div>;
  if (!me) {
    return (
      <div className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to view the economic calendar.</p>
        <Link href="/login" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">Sign in</Link>
      </div>
    );
  }

  // Group by date (yyyy-mm-dd) — server returns ascending.
  const groups = new Map<string, EconomicEvent[]>();
  for (const e of events) {
    const d = e.ts.slice(0, 10);
    const list = groups.get(d) ?? [];
    list.push(e);
    groups.set(d, list);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Economic calendar</h1>
          <p className="text-xs text-text-mute">
            Forex Factory weekly · used by the Risk Agent for event blackouts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter value={impact} onChange={setImpact} />
          <button
            type="button"
            onClick={refresh}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-accent/40 hover:text-text"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>
      )}

      {events.length === 0 && !loading ? (
        <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
          No events in this window. (If you just started the api, the ingestor
          fetches on startup — check back in a moment.)
        </div>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs uppercase tracking-widest text-text-mute">
                {new Date(day + "T00:00:00Z").toLocaleDateString("en-GB", {
                  weekday: "long", month: "short", day: "numeric",
                })}
              </h2>
              <ul className="space-y-1">
                {list.map((e) => (
                  <li
                    key={e.event_id}
                    className={`flex flex-wrap items-baseline gap-3 rounded-md border ${IMPACT_RING[e.impact]} bg-bg-card px-3 py-2 text-sm`}
                  >
                    <span className="num text-xs text-text-mute">
                      {new Date(e.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`text-[10px] uppercase tracking-widest ${IMPACT_COLOR[e.impact]}`}>
                      ● {e.impact}
                    </span>
                    <span className="num text-text-dim">{e.country}</span>
                    <span className="flex-1 truncate text-text">{e.name}</span>
                    {e.forecast && (
                      <span className="num text-xs text-text-mute">fcst {e.forecast}</span>
                    )}
                    {e.previous && (
                      <span className="num text-xs text-text-mute">prev {e.previous}</span>
                    )}
                    {e.affected_assets.length > 0 && (
                      <div className="flex gap-1">
                        {e.affected_assets.map((a) => (
                          <span key={a} className="num rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] text-text-dim">{a}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Filter({ value, onChange }: { value: ImpactFilter; onChange: (v: ImpactFilter) => void }) {
  const opts: { v: ImpactFilter; label: string }[] = [
    { v: "all", label: "All" },
    { v: "high", label: "High only" },
    { v: "medium", label: "Medium+" },
  ];
  return (
    <div className="flex gap-1 rounded-md border border-border bg-bg-elev-1 p-1 text-xs">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`rounded px-2 py-1 transition ${
            value === o.v ? "bg-accent text-white" : "text-text-dim hover:text-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
