"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  api,
  ApiError,
  type CompanyMember,
  type InviteCreated,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";

const ROLE_LABEL: Record<CompanyMember["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  trader: "Trader",
  viewer: "Viewer",
};

const ROLE_RANK: Record<CompanyMember["role"], number> = {
  owner: 0,
  admin: 1,
  trader: 2,
  viewer: 3,
};

export default function MembersPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [members, setMembers] = useState<CompanyMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [lastInvite, setLastInvite] = useState<InviteCreated | null>(null);

  const myMembership = members?.find((m) => m.account_id === me?.account_id);
  const canWrite =
    myMembership?.role === "owner" || myMembership?.role === "admin";

  const refresh = useCallback(async () => {
    if (!activeCompanyId) return;
    try {
      const r = await api.listMembers(activeCompanyId);
      setMembers(r.members);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "failed to load");
    }
  }, [activeCompanyId]);

  useEffect(() => {
    setMembers(null);
    refresh();
  }, [refresh]);

  if (authLoading) {
    return <main className="px-6 py-8 text-sm text-text-mute">Loading…</main>;
  }
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-4 text-sm text-text-mute">Sign in to manage members.</p>
        <Link
          href="/login"
          className="rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg"
        >
          Sign in
        </Link>
      </main>
    );
  }
  if (!active) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center text-sm text-text-mute">
        Create or select a company first.
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {active.name} — Members
          </h1>
          <p className="text-xs text-text-mute">
            {members?.length ?? 0} member
            {(members?.length ?? 0) === 1 ? "" : "s"}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          >
            + Invite person
          </button>
        )}
      </header>

      {loadError && (
        <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
          {loadError}
        </div>
      )}

      {lastInvite && (
        <div className="mb-4 rounded-2xl border border-bull/40 bg-bull-soft p-4">
          <div className="mb-1 text-xs uppercase tracking-widest text-bull">
            Invite ready
          </div>
          <p className="mb-2 text-sm text-text">
            Send <span className="text-text">{lastInvite.email}</span> this link.
            (Dev mode — Resend not wired yet, see PLAN §33.5.)
          </p>
          <code className="block break-all rounded-md bg-bg-elev-1 p-2 text-xs text-text-dim">
            {lastInvite.accept_url}
          </code>
          <button
            type="button"
            onClick={() => navigator.clipboard.writeText(lastInvite.accept_url)}
            className="mt-2 text-xs text-bull hover:opacity-80"
          >
            Copy link
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg-elev-1 text-text-mute">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Title</Th>
              <Th>Since</Th>
              <Th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((m) => (
              <MemberRow
                key={m.account_id}
                member={m}
                isMe={m.account_id === me.account_id}
                canWrite={!!canWrite}
                callerIsOwner={myMembership?.role === "owner"}
                onChanged={refresh}
                companyId={active.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {showInvite && (
        <InviteModal
          companyId={active.id}
          onClose={() => setShowInvite(false)}
          onCreated={(inv) => {
            setLastInvite(inv);
            setShowInvite(false);
            refresh();
          }}
        />
      )}
    </main>
  );
}

function MemberRow({
  member,
  isMe,
  canWrite,
  callerIsOwner,
  onChanged,
  companyId,
}: {
  member: CompanyMember;
  isMe: boolean;
  canWrite: boolean;
  callerIsOwner: boolean;
  onChanged: () => Promise<void>;
  companyId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admins can modify trader/viewer/admin. Only owners can change
  // owner-level rows. Last owner can never be demoted (server enforces).
  const writeable =
    canWrite &&
    !isMe &&
    (member.role !== "owner" || callerIsOwner);

  const allowedRoles: CompanyMember["role"][] = callerIsOwner
    ? ["owner", "admin", "trader", "viewer"]
    : ["admin", "trader", "viewer"];

  async function changeRole(role: CompanyMember["role"]) {
    if (role === member.role) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateMember(companyId, member.account_id, {
        role,
        title: member.title ?? undefined,
      });
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        `Remove ${member.full_name ?? member.email} from this company?`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.removeMember(companyId, member.account_id);
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "remove failed");
      setBusy(false);
    }
  }

  return (
    <tr className="border-b border-border last:border-0">
      <Td>
        <span>{member.full_name ?? "—"}</span>
        {isMe && (
          <span className="ml-2 rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] text-text-mute">
            you
          </span>
        )}
      </Td>
      <Td className="text-text-dim">{member.email}</Td>
      <Td>
        {writeable ? (
          <select
            value={member.role}
            disabled={busy}
            onChange={(e) => changeRole(e.target.value as CompanyMember["role"])}
            className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-xs outline-none focus:border-bull disabled:opacity-50"
          >
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs">{ROLE_LABEL[member.role]}</span>
        )}
        {error && <div className="mt-1 text-[10px] text-bear">{error}</div>}
      </Td>
      <Td className="text-text-dim">{member.title ?? "—"}</Td>
      <Td className="num text-xs text-text-mute">
        {new Date(member.joined_at).toLocaleDateString("en-GB")}
      </Td>
      <Td>
        {writeable && member.role !== "owner" && (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="text-xs text-bear hover:opacity-80 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </Td>
    </tr>
  );
}

function InviteModal({
  companyId,
  onClose,
  onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: (inv: InviteCreated) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "trader" | "viewer">("trader");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const inv = await api.createInvite(companyId, {
        email: email.trim(),
        role,
        title: title.trim() || undefined,
      });
      onCreated(inv);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "invite failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Invite someone</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
              autoFocus
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
              Role
            </span>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "admin" | "trader" | "viewer")
              }
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
            >
              <option value="admin">Admin — manage agents, members, settings</option>
              <option value="trader">Trader — chat + manual trades</option>
              <option value="viewer">Viewer — read-only</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
              Title (optional)
            </span>
            <input
              type="text"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Head of Risk"
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
            />
          </label>

          {error && (
            <div className="rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3 py-2 text-sm hover:border-bull/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email.trim()}
              className="rounded-md bg-bull px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create invite"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left text-xs font-medium uppercase tracking-widest ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-3 align-top ${className}`}>{children}</td>;
}
