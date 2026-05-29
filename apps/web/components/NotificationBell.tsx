"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api, ApiError, type Notification } from "@/lib/api";

const POLL_MS = 30_000;
const FMT = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

function relativeFromNow(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return FMT.format(new Date(iso));
}

function kindGlyph(kind: string): string {
  if (kind === "manager_meeting") return "🪑";
  if (kind === "manager_review") return "📋";
  return "🔔";
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    try {
      const r = await api.listNotifications(20);
      setItems(r.items);
      setUnread(r.unread);
      setError(null);
    } catch (e) {
      // Bell is a peripheral feature — swallow auth errors silently so it
      // doesn't spam the console while the user is signed out.
      if (e instanceof ApiError && e.status === 401) return;
      setError(e instanceof ApiError ? e.message : "load failed");
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function markRead(id: string) {
    try {
      await api.markNotificationRead(id);
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      setUnread((u) => Math.max(0, u - 1));
    } catch { /* ignore */ }
  }

  async function markAllRead() {
    setBusy(true);
    try {
      await api.markAllNotificationsRead();
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => n.read_at ? n : { ...n, read_at: now }));
      setUnread(0);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-8 w-8 place-items-center rounded-md border border-border bg-bg-elev-2 text-text-dim hover:border-accent/40 hover:text-text"
        aria-label="Notifications"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-md border border-border bg-bg-card shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
            <span className="uppercase tracking-widest text-text-mute">Notifications</span>
            <button
              type="button"
              onClick={markAllRead}
              disabled={busy || unread === 0}
              className="text-text-mute hover:text-text disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          {error && (
            <div className="border-b border-border px-3 py-2 text-xs text-bear">{error}</div>
          )}
          {items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-text-mute">
              You're all caught up.
            </div>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => {
                const Inner = (
                  <div className="flex gap-2">
                    <span className="text-base leading-none">{kindGlyph(n.kind)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{n.title}</div>
                      {n.body && (
                        <div className="line-clamp-2 text-xs text-text-mute">{n.body}</div>
                      )}
                      <div className="mt-0.5 text-[10px] text-text-mute">{relativeFromNow(n.created_at)}</div>
                    </div>
                    {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                  </div>
                );
                return (
                  <li key={n.id} className="border-b border-border last:border-b-0">
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => { setOpen(false); if (!n.read_at) markRead(n.id); }}
                        className={`block px-3 py-2 hover:bg-bg-elev-1 ${n.read_at ? "opacity-70" : ""}`}
                      >
                        {Inner}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { if (!n.read_at) markRead(n.id); }}
                        className={`block w-full px-3 py-2 text-left hover:bg-bg-elev-1 ${n.read_at ? "opacity-70" : ""}`}
                      >
                        {Inner}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
