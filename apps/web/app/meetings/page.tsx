"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  api,
  ApiError,
  type Agent,
  type MeetingKind,
  type MeetingSummary,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FMT_DT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

const PAGE_SIZE = 20;

function kindLabel(k: MeetingKind): string {
  return k === "meeting" ? "1:1" : "Team review";
}

export default function MeetingsPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [items, setItems] = useState<MeetingSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState<MeetingKind | "">("");
  const [employeeId, setEmployeeId] = useState<string>("");
  const [page, setPage] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Employee dropdown options — only non-manager agents (a manager
  // doesn't sit on the "other side" of a 1:1).
  const employeeOptions = useMemo(
    () => agents
      .filter((a) => a.role !== "manager")
      .sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  // Load agents once per company so the dropdown populates.
  useEffect(() => {
    if (!activeCompanyId) return;
    let cancelled = false;
    api.listAgents(activeCompanyId)
      .then((r) => { if (!cancelled) setAgents(r.agents); })
      .catch(() => { /* dropdown stays empty — non-blocking */ });
    return () => { cancelled = true; };
  }, [activeCompanyId]);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true); setError(null);
    try {
      const r = await api.listMeetings(activeCompanyId, {
        kind: kind || undefined,
        employee_id: employeeId || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, kind, employeeId, page]);

  useEffect(() => { refresh(); }, [refresh]);

  // Filter changes reset to page 0 — the user almost never wants page
  // 7 of the new filter set.
  function applyKind(k: MeetingKind | "") {
    setKind(k);
    setPage(0);
  }
  function applyEmployee(id: string) {
    setEmployeeId(id);
    setPage(0);
  }

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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{active.name} — Meetings</h1>
            <p className="text-xs text-text-mute">
              Every team review and 1:1 the manager has held, with full transcripts.
            </p>
          </div>
          <button
            type="button" onClick={refresh}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-bull/40 hover:text-text"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {/* Filter bar */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-md border border-border bg-bg-elev-1 p-1 text-xs">
            {[
              { v: "", label: "All" },
              { v: "meeting", label: "1:1 meetings" },
              { v: "review", label: "Team reviews" },
            ].map((o) => (
              <button
                key={o.v} type="button" onClick={() => applyKind(o.v as MeetingKind | "")}
                className={`rounded px-2 py-1 ${kind === o.v ? "bg-accent text-white" : "text-text-mute hover:text-text"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-text-mute">
            With:
            <select
              value={employeeId}
              onChange={(e) => applyEmployee(e.target.value)}
              className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-xs text-text hover:border-accent/40 focus:border-accent focus:outline-none"
            >
              <option value="">any employee</option>
              {employeeOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          {(kind || employeeId) && (
            <button
              type="button"
              onClick={() => { applyKind(""); applyEmployee(""); }}
              className="text-xs text-text-mute underline-offset-2 hover:text-text hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </header>

      {error && <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
          {total === 0 && !kind && !employeeId ? (
            <>No meetings yet. Click <span className="num">Run review now</span> on the manager profile or <span className="num">Hold 1:1</span> on an employee.</>
          ) : (
            <>No meetings match this filter.</>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.id}>
              <Link
                href={`/meetings/${m.id}`}
                className="block rounded-2xl border border-border bg-bg-card p-4 hover:border-accent/40"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                      m.kind === "meeting" ? "bg-accent/15 text-accent" : "bg-bg-elev-2 text-text-mute"
                    }`}>
                      {kindLabel(m.kind)}
                    </span>
                    <span className="text-sm">
                      <span className="font-medium">{m.manager_name ?? "manager"}</span>
                      {m.employee_name && (
                        <>
                          {" → "}
                          <span className="text-accent">{m.employee_name}</span>
                        </>
                      )}
                    </span>
                    {!m.has_transcript && (
                      <span className="text-[10px] text-text-mute">(no transcript — pre-update meeting)</span>
                    )}
                  </div>
                  <span className="text-xs text-text-mute">{FMT_DT.format(new Date(m.created_at))}</span>
                </div>
                {m.agenda && (
                  <div className="mt-2 text-xs text-text-mute">
                    <span className="uppercase tracking-widest">Agenda:</span> {m.agenda}
                  </div>
                )}
                {m.narrative_preview && (
                  <p className="mt-2 line-clamp-3 text-sm text-text-dim">{m.narrative_preview}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Pager — only when total exceeds one page. Shows numeric range
          so the user knows what window they're on. */}
      {total > PAGE_SIZE && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-text-mute">
          <span>
            Showing <span className="num text-text">{pageStart}–{pageEnd}</span> of{" "}
            <span className="num text-text">{total}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-border px-3 py-1.5 text-text-dim hover:border-accent/40 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="num">
              Page {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page + 1 >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-border px-3 py-1.5 text-text-dim hover:border-accent/40 hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
