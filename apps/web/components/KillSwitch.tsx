"use client";

import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type SafetyState } from "@/lib/api";

/** Big red kill switch for the top of the dashboard. Owners/admins only —
 *  the api enforces the role check. When active, every new intent gets
 *  rejected by the risk agent until an admin flips it back off. Open
 *  positions stay open (we don't yet have a Deriv sell integration).
 */
export default function KillSwitch({ companyId }: { companyId: string }) {
  const [state, setState] = useState<SafetyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");

  const refresh = useCallback(async () => {
    try {
      setState(await api.getSafety(companyId));
    } catch (e) {
      // Read fails are non-fatal — keep the previous state.
      void e;
    }
  }, [companyId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function activate() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const next = await api.setKillSwitch(companyId, true, reason.trim());
      setState(next);
      setConfirmOpen(false);
      setReason("");
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "kill-switch failed");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    setBusy(true);
    try {
      setState(await api.setKillSwitch(companyId, false));
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "kill-switch failed");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  if (state.kill_switch_active) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border-2 border-bear bg-bear-soft px-4 py-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-bear text-xs font-bold text-white">!</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-widest text-bear">Kill switch ACTIVE</div>
          <div className="truncate text-xs text-text-dim" title={state.kill_switch_reason ?? ""}>
            {state.kill_switch_reason ?? "—"}
          </div>
        </div>
        <button
          type="button"
          onClick={deactivate}
          disabled={busy}
          className="rounded-md border border-bear/40 bg-bg-card px-3 py-1.5 text-xs text-text hover:border-bear disabled:opacity-50"
        >
          {busy ? "…" : "Deactivate"}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className="rounded-md border border-bear/40 bg-bg-card px-3 py-1.5 text-xs font-medium text-bear hover:bg-bear-soft"
        title="Stop all new trades immediately"
      >
        ⏻ Kill switch
      </button>

      {confirmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-bear/40 bg-bg-card p-5">
            <h2 className="mb-2 text-base font-semibold text-bear">Activate kill switch?</h2>
            <p className="mb-3 text-xs text-text-dim">
              All new trade intents will be rejected by the Risk Agent until
              you turn this off. <b>Open positions stay open on the broker
              side</b> — we don't have a Deriv sell integration yet, so they
              settle on their stop/target. Use only when you want to stop new
              activity.
            </p>
            <label className="mb-3 block text-xs text-text-mute">
              Reason (audited)
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. manual review after spike"
                className="mt-1 w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bear"
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setConfirmOpen(false); setReason(""); }}
                className="rounded-md border border-border px-3 py-2 text-sm text-text-dim hover:border-text"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={activate}
                disabled={busy || !reason.trim()}
                className="rounded-md bg-bear px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "…" : "Activate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
