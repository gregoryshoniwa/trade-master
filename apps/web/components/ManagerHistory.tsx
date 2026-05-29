"use client";

import { useEffect, useState } from "react";

import { api, ApiError, type ManagerAction } from "@/lib/api";

const FMT_DT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toString();
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

function ActionTag({ kind }: { kind: ManagerAction["action_kind"] }) {
  const cls =
    kind === "adjust"
      ? "bg-accent/15 text-accent"
      : kind === "pause"
        ? "bg-bear/15 text-bear"
        : kind === "resume"
          ? "bg-bull/15 text-bull"
          : "bg-bg-elev-2 text-text-mute";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`}>
      {kind}
    </span>
  );
}

/** Shows the last N actions the manager has taken affecting this employee. */
export default function ManagerHistory({
  companyId,
  employeeId,
  limit = 10,
}: {
  companyId: string;
  employeeId: string;
  limit?: number;
}) {
  const [actions, setActions] = useState<ManagerAction[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .listManagerActions(companyId, { employeeId, limit })
      .then((p) => {
        if (!cancelled) setActions(p.actions);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof ApiError ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, employeeId, limit]);

  if (error) {
    return <div className="text-sm text-text-mute">Couldn't load manager history: {error}</div>;
  }
  if (actions === null) {
    return <div className="text-sm text-text-mute">Loading…</div>;
  }
  // Reviews that didn't act on this employee are noise here — filter them out.
  const acted = actions.filter((a) => a.action_kind !== "review");
  if (acted.length === 0) {
    return (
      <div className="text-sm text-text-mute">
        The Manager hasn't touched this agent yet.
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {acted.map((a) => (
        <li key={a.id} className="rounded-lg bg-bg-elev-1 p-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <ActionTag kind={a.action_kind} />
              <span className="text-text-mute">
                by {a.manager_name ?? "manager"}
              </span>
            </div>
            <span className="text-text-mute">
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
            <div className="mt-1 text-sm text-text">{a.reason}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
