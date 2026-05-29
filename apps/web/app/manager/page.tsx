"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type Agent, type ManagerAction } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FMT_DT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

const PAGE_SIZE = 25;

type Kind = "review" | "adjust" | "pause" | "resume";

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function kindClass(k: Kind): string {
  if (k === "adjust") return "bg-accent/15 text-accent";
  if (k === "pause") return "bg-bear/15 text-bear";
  if (k === "resume") return "bg-bull/15 text-bull";
  return "bg-bg-elev-2 text-text-mute";
}

export default function ManagerActivityPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [items, setItems] = useState<ManagerAction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [page, setPage] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    setPage(0);
  }, [employeeId, kind]);

  useEffect(() => {
    if (!activeCompanyId) return;
    api.listAgents(activeCompanyId).then((r) => setAgents(r.agents)).catch(() => { /* ignore */ });
  }, [activeCompanyId]);

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listManagerActions(activeCompanyId, {
        employeeId: employeeId || undefined,
        actionKind: kind || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(r.actions);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [activeCompanyId, employeeId, kind, page]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const pageEnd = Math.min(total, (page + 1) * PAGE_SIZE);
  const filtered = !!(employeeId || kind);
  const employees = agents.filter((a) => a.role !== "manager");

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to view manager activity.</p>
        <Link href="/login" className="rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg">Sign in</Link>
      </main>
    );
  }
  if (!active) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">
        Select or create a company first.
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{active.name} — Manager activity</h1>
          <p className="text-xs text-text-mute">
            Every review the Manager Agent ran and every adjustment, pause, or resume it applied.
          </p>
        </div>
        <button type="button" onClick={refresh}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-text-dim hover:border-bull/40 hover:text-text">
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="mb-4 rounded-2xl border border-border bg-bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <Filter label="Employee">
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={selectCls}>
              <option value="">All employees</option>
              {employees.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Filter>
          <Filter label="Action">
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind | "")} className={selectCls}>
              <option value="">All kinds</option>
              <option value="review">Reviews</option>
              <option value="adjust">Adjustments</option>
              <option value="pause">Pauses</option>
              <option value="resume">Resumes</option>
            </select>
          </Filter>
          <Filter label="&nbsp;">
            <button
              type="button"
              onClick={() => { setEmployeeId(""); setKind(""); }}
              disabled={!filtered}
              className="h-full rounded-md border border-border px-3 py-2 text-xs text-text-dim hover:border-bull/40 hover:text-text disabled:opacity-40"
            >
              Clear filters
            </button>
          </Filter>
        </div>
      </section>

      {error && <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">{error}</div>}

      {total === 0 ? (
        <div className="rounded-2xl border border-border bg-bg-card p-6 text-center text-sm text-text-mute">
          {filtered
            ? "No manager actions match these filters."
            : "The Manager Agent hasn't acted yet. Reviews run every 4 hours."}
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {items.map((a) => (
              <li key={a.id} className="rounded-2xl border border-border bg-bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${kindClass(a.action_kind)}`}>
                      {a.action_kind}
                    </span>
                    <span className="text-sm font-medium">
                      {a.manager_name ?? "manager"}
                      {a.employee_name && (
                        <>
                          {" → "}
                          <span className="text-accent">{a.employee_name}</span>
                        </>
                      )}
                    </span>
                  </div>
                  <span className="text-xs text-text-mute">
                    {FMT_DT.format(new Date(a.created_at))}
                  </span>
                </div>

                {a.action_kind === "adjust" && a.field_name && (
                  <div className="mt-2 text-sm">
                    <span className="font-mono text-text-mute">{a.field_name}</span>
                    {": "}
                    <span className="num">{formatVal(a.before_value)}</span>
                    {" → "}
                    <span className="num text-accent">{formatVal(a.after_value)}</span>
                  </div>
                )}

                {a.reason && (
                  <p className="mt-2 text-sm text-text-dim">{a.reason}</p>
                )}

                {a.llm_narrative && a.action_kind === "review" && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-text-mute hover:text-text">
                      Show manager's review notes
                    </summary>
                    <p className="mt-2 whitespace-pre-line rounded-md bg-bg-elev-1 p-3 text-sm text-text-dim">
                      {a.llm_narrative}
                    </p>
                  </details>
                )}
              </li>
            ))}
          </ul>

          <nav className="mt-6 flex items-center justify-between text-xs text-text-mute">
            <span className="num">
              {pageStart}–{pageEnd} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="rounded-md border border-border px-2 py-1 hover:border-bull/40 hover:text-text disabled:opacity-40"
              >
                ◂ Prev
              </button>
              <span className="num">page {page + 1} / {pageCount}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1 || loading}
                className="rounded-md border border-border px-2 py-1 hover:border-bull/40 hover:text-text disabled:opacity-40"
              >
                Next ▸
              </button>
            </div>
          </nav>
        </>
      )}
    </main>
  );
}

const selectCls =
  "w-full rounded-md border border-border bg-bg-elev-1 px-2 py-1.5 text-xs text-text outline-none focus:border-accent";

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-widest text-text-mute">{label}</span>
      {children}
    </label>
  );
}
