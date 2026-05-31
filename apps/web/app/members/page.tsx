"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api, ApiError, type CompanyMember } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const ROLE_LABEL: Record<CompanyMember["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  trader: "Trader",
  viewer: "Viewer",
};

export default function MembersPage() {
  const { me, activeCompanyId, companies, loading: authLoading } = useAuth();
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  const [members, setMembers] = useState<CompanyMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [tempBanner, setTempBanner] = useState<
    { email: string; temp_password: string; reason: "created" | "reset" } | null
  >(null);

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
        <Link href="/login" className="rounded-md bg-bull px-3 py-2 text-sm font-medium text-bg">
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
            {members?.length ?? 0} member{(members?.length ?? 0) === 1 ? "" : "s"}
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          >
            + Add member
          </button>
        )}
      </header>

      {loadError && (
        <div className="mb-4 rounded-md border border-bear/40 bg-bear-soft p-3 text-sm text-bear">
          {loadError}
        </div>
      )}

      {tempBanner && (
        <PasswordBanner
          banner={tempBanner}
          onDismiss={() => setTempBanner(null)}
        />
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
              <Th className="w-40" />
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
                onTempPassword={(t) => setTempBanner({ ...t, reason: "reset" })}
                companyId={active.id}
              />
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <AddMemberModal
          companyId={active.id}
          onClose={() => setShowCreate(false)}
          onCreated={(member, password) => {
            setShowCreate(false);
            setTempBanner({
              email: member.email,
              temp_password: password,
              reason: "created",
            });
            refresh();
          }}
        />
      )}
    </main>
  );
}

function PasswordBanner({
  banner,
  onDismiss,
}: {
  banner: { email: string; temp_password: string; reason: "created" | "reset" };
  onDismiss: () => void;
}) {
  const verb = banner.reason === "created" ? "Account created" : "Password reset";
  return (
    <div className="mb-4 rounded-2xl border border-bull/40 bg-bull-soft p-4">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-xs uppercase tracking-widest text-bull">
        <span>{verb}</span>
        <button type="button" onClick={onDismiss} className="text-text-mute hover:text-text">
          dismiss
        </button>
      </div>
      <p className="mb-2 text-sm text-text">
        Share this password with <span className="num">{banner.email}</span>{" "}
        out-of-band. They can log in immediately and change it from their account.
      </p>
      <div className="flex items-center gap-2">
        <code className="block flex-1 break-all rounded-md bg-bg-elev-1 p-2 text-sm font-mono text-text">
          {banner.temp_password}
        </code>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(banner.temp_password)}
          className="rounded-md border border-bull/40 px-3 py-2 text-xs text-bull hover:bg-bull/10"
        >
          Copy
        </button>
      </div>
    </div>
  );
}

function MemberRow({
  member, isMe, canWrite, callerIsOwner, onChanged, onTempPassword, companyId,
}: {
  member: CompanyMember;
  isMe: boolean;
  canWrite: boolean;
  callerIsOwner: boolean;
  onChanged: () => Promise<void>;
  onTempPassword: (t: { email: string; temp_password: string }) => void;
  companyId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(member.full_name ?? "");

  // Admins can modify trader/viewer/admin. Only owners can change
  // owner-level rows. Last owner can never be demoted (server enforces).
  const writeable = canWrite && !isMe && (member.role !== "owner" || callerIsOwner);
  // Self can edit own name freely; admins/owners can edit others' names too.
  const canEditName = isMe || writeable;

  const allowedRoles: CompanyMember["role"][] = callerIsOwner
    ? ["owner", "admin", "trader", "viewer"]
    : ["admin", "trader", "viewer"];

  async function changeRole(role: CompanyMember["role"]) {
    if (role === member.role) return;
    setBusy(true); setError(null);
    try {
      await api.updateMember(companyId, member.account_id, { role });
      await onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "update failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveName() {
    const next = nameDraft.trim();
    if (!next || next === (member.full_name ?? "")) {
      setEditingName(false);
      return;
    }
    setBusy(true); setError(null);
    try {
      await api.updateMember(companyId, member.account_id, { full_name: next });
      await onChanged();
      setEditingName(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "name update failed");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!window.confirm(`Reset password for ${member.full_name ?? member.email}?`)) return;
    setBusy(true); setError(null);
    try {
      const r = await api.resetMemberPassword(companyId, member.account_id);
      onTempPassword({ email: r.email, temp_password: r.temp_password });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${member.full_name ?? member.email} from this company?`)) return;
    setBusy(true); setError(null);
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
        {editingName ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                else if (e.key === "Escape") { setEditingName(false); setNameDraft(member.full_name ?? ""); }
              }}
              className="rounded-md border border-border bg-bg-elev-1 px-2 py-1 text-xs outline-none focus:border-bull"
            />
            <button type="button" onClick={saveName} disabled={busy}
              className="text-xs text-bull hover:opacity-80 disabled:opacity-50">save</button>
            <button type="button"
              onClick={() => { setEditingName(false); setNameDraft(member.full_name ?? ""); }}
              className="text-xs text-text-mute hover:text-text">cancel</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => canEditName && setEditingName(true)}
            className={`text-left ${canEditName ? "hover:text-bull" : ""}`}
            title={canEditName ? "Click to rename" : ""}
          >
            <span>{member.full_name ?? "—"}</span>
            {isMe && (
              <span className="ml-2 rounded-full bg-bg-elev-2 px-2 py-0.5 text-[10px] text-text-mute">
                you
              </span>
            )}
          </button>
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
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
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
        <div className="flex justify-end gap-3 text-xs">
          {writeable && (
            <button type="button" disabled={busy} onClick={resetPassword}
              className="text-warning hover:opacity-80 disabled:opacity-50">
              Reset password
            </button>
          )}
          {writeable && member.role !== "owner" && (
            <button type="button" disabled={busy} onClick={remove}
              className="text-bear hover:opacity-80 disabled:opacity-50">
              Remove
            </button>
          )}
        </div>
      </Td>
    </tr>
  );
}

function _genPassword(): string {
  // Browser-side helper for the "generate password" button. Same
  // alphabet as the server's _gen_temp_password — mirror keeps a
  // dictated password from accidentally ambiguous chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 14; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function AddMemberModal({
  companyId, onClose, onCreated,
}: {
  companyId: string;
  onClose: () => void;
  onCreated: (m: CompanyMember, password: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState(_genPassword);
  const [role, setRole] = useState<"admin" | "trader" | "viewer">("trader");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true); setError(null);
    try {
      const m = await api.createMember(companyId, {
        email: email.trim(),
        full_name: name.trim(),
        password,
        role,
        title: title.trim() || undefined,
      });
      onCreated(m, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "create failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-bg-card p-6">
        <h2 className="mb-4 text-lg font-semibold">Add a member</h2>
        <p className="mb-4 text-xs text-text-mute">
          Create an account for someone on your team. They'll be able to sign
          in immediately with the password you set — share it with them
          out-of-band.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
              Email
            </span>
            <input
              type="email" required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
              autoFocus
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
              Full name
            </span>
            <input
              type="text" required maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tendai Mukasa"
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm outline-none focus:border-bull"
            />
          </label>

          <label className="block">
            <span className="mb-1 flex items-baseline justify-between text-xs uppercase tracking-widest text-text-mute">
              <span>Initial password</span>
              <button type="button" onClick={() => setPassword(_genPassword())}
                className="text-[10px] text-bull hover:underline normal-case">
                generate new
              </button>
            </span>
            <input
              type="text" required minLength={10} maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-border bg-bg-elev-1 px-3 py-2 text-sm font-mono outline-none focus:border-bull"
            />
            <span className="mt-1 block text-[10px] text-text-mute">
              Min 10 chars · mix of upper/lower · at least one digit.
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-widest text-text-mute">
              Role
            </span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "trader" | "viewer")}
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
              type="text" maxLength={120}
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
              type="button" onClick={onClose}
              className="rounded-md border border-border px-3 py-2 text-sm hover:border-bull/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !email.trim() || !name.trim() || password.length < 10}
              className="rounded-md bg-bull px-4 py-2 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Creating…" : "Create member"}
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
