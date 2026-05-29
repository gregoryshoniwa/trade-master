"use client";

/**
 * Passkey enrollment. One-time onboarding — register a Touch ID / Face ID
 * / hardware key on this device, then the api will accept paper → live
 * trade-mode flips for the next 5 minutes after a sign.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { assertPasskey, registerPasskey } from "@/lib/passkey";

export default function PasskeysPage() {
  const { me, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<{ has_passkey: boolean; count: number } | null>(null);
  const [busy, setBusy] = useState<"register" | "sign" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.passkeyStatus());
    } catch {
      /* ignore — page still renders */
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function onRegister() {
    setBusy("register"); setError(null); setInfo(null);
    try {
      await registerPasskey("Primary device");
      setInfo("Passkey saved on this device.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : (e instanceof ApiError ? e.message : "register failed"));
    } finally {
      setBusy(null);
    }
  }

  async function onSign() {
    setBusy("sign"); setError(null); setInfo(null);
    try {
      await assertPasskey();
      setInfo("Verified. Trade-mode flips are unlocked for the next 5 minutes.");
    } catch (e) {
      setError(e instanceof Error ? e.message : (e instanceof ApiError ? e.message : "sign failed"));
    } finally {
      setBusy(null);
    }
  }

  if (authLoading) return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">
        <Link href="/login" className="text-bull">Sign in first</Link>
      </main>
    );
  }

  const hasIt = status?.has_passkey ?? false;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-lg font-semibold tracking-tight">Passkeys</h1>
      <p className="mt-1 text-sm text-text-mute">
        Required to flip the company out of <span className="num">paper_mode</span>.
        Once you've enrolled a device, you'll need to sign with it whenever
        you take the company off paper trading. Going back into paper mode
        is always allowed without a passkey — the brake is never gated.
      </p>

      <section className="mt-6 rounded-2xl border border-border bg-bg-card p-5">
        <div className="flex items-baseline justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-widest text-text-mute">
              Status on this account
            </div>
            <div className={`mt-1 num text-sm ${hasIt ? "text-bull" : "text-warning"}`}>
              {hasIt
                ? `✓ ${status!.count} passkey${status!.count === 1 ? "" : "s"} registered`
                : "✗ no passkey registered yet"}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRegister}
              disabled={busy !== null}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50"
            >
              {busy === "register" ? "Touch your authenticator…" : hasIt ? "Add another" : "Register passkey"}
            </button>
            {hasIt && (
              <button
                type="button"
                onClick={onSign}
                disabled={busy !== null}
                className="rounded-md border border-border bg-bg-elev-1 px-4 py-2 text-sm hover:border-accent/40 disabled:opacity-50"
              >
                {busy === "sign" ? "Verifying…" : "Sign now"}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
            {error}
          </div>
        )}
        {info && (
          <div className="mt-4 rounded-md border border-bull/30 bg-bull-soft p-3 text-sm text-bull">
            {info}
          </div>
        )}
      </section>

      <p className="mt-6 text-[11px] text-text-mute">
        Tip: most modern laptops will offer Touch ID; phones will offer Face
        ID or fingerprint; a YubiKey or similar hardware key also works.
        You can register more than one device.
      </p>
    </main>
  );
}
