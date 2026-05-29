"use client";

import { useEffect, useState } from "react";

import { api, ApiError, type EmployeeMeetingRequest } from "@/lib/api";

const FMT_DT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

/** Show pending employee → manager meeting requests on the manager
 *  profile. The manager picks these up automatically at the next
 *  scheduled review; this surface lets the CEO see what's queued and
 *  trigger a run themselves if they don't want to wait. */
export default function PendingRequests({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<EmployeeMeetingRequest[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.listEmployeeRequests(companyId).then((r) => {
      if (!cancelled) setItems(r);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof ApiError ? e.message : "load failed");
    });
    return () => { cancelled = true; };
  }, [companyId]);

  if (error) {
    return <div className="text-sm text-text-mute">Couldn't load requests: {error}</div>;
  }
  const pending = items.filter((r) => r.status === "pending");
  const addressed = items.filter((r) => r.status !== "pending").slice(0, 5);
  if (pending.length === 0 && addressed.length === 0) {
    return <div className="text-sm text-text-mute">No employee requests yet.</div>;
  }
  return (
    <div className="space-y-3">
      {pending.length > 0 && (
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-widest text-text-mute">
            Pending ({pending.length})
          </div>
          <ul className="space-y-2">
            {pending.map((r) => (
              <li key={r.id} className="rounded-lg border border-accent/30 bg-bg-elev-1 p-3">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-accent">{r.employee_name ?? "an employee"}</span>
                  <span className="text-text-mute">{FMT_DT.format(new Date(r.created_at))}</span>
                </div>
                <p className="mt-1 text-sm">{r.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {addressed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-text-mute hover:text-text">
            Recently addressed ({addressed.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {addressed.map((r) => (
              <li key={r.id} className="text-xs text-text-mute">
                <span className="text-text-dim">{r.employee_name}:</span> {r.reason.slice(0, 80)}{r.reason.length > 80 ? "…" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
