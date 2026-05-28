"use client";

import Link from "next/link";
import { useState } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth";

type Props = {
  onMobileMenu?: () => void;
};

/** Slim top bar (~48px). Mobile hamburger on the left, company switcher +
 *  theme toggle + account dropdown on the right. Nav links live in the
 *  Sidebar — this bar deliberately stays out of the way. */
export default function TopBar({ onMobileMenu }: Props) {
  const { loading, me, companies, activeCompanyId, setActiveCompany, logout } = useAuth();
  const [companiesOpen, setCompaniesOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-bg-elev-1 px-3">
      <div className="flex items-center gap-2">
        {/* Mobile-only hamburger — sidebar is hidden below md. */}
        <button
          type="button"
          onClick={onMobileMenu}
          aria-label="Open menu"
          className="grid h-8 w-8 place-items-center rounded-md border border-border text-text-dim hover:border-accent/40 hover:text-text md:hidden"
        >
          <HamburgerIcon />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {me && active && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setCompaniesOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-2 px-3 py-1.5 text-sm hover:border-accent/40"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: active.brand_color ?? "#2962FF" }}
              />
              <span className="hidden sm:inline">{active.name}</span>
              <span className="num text-text-mute">· T{active.current_asset_tier}</span>
              <span className="text-text-mute">▾</span>
            </button>
            {companiesOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-bg-card p-1 shadow-xl">
                {companies.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveCompany(c.id);
                      setCompaniesOpen(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-bg-elev-2 ${
                      c.id === activeCompanyId ? "bg-bg-elev-2" : ""
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: c.brand_color ?? "#2962FF" }}
                    />
                    <span className="flex-1">{c.name}</span>
                    <span className="num text-xs text-text-mute">{c.role}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <Link
                  href="/companies/new"
                  onClick={() => setCompaniesOpen(false)}
                  className="block rounded px-2 py-2 text-sm text-accent hover:bg-bg-elev-2"
                >
                  + Create new company
                </Link>
              </div>
            )}
          </div>
        )}

        <ThemeToggle />

        {loading ? (
          <span className="text-xs text-text-mute">…</span>
        ) : me ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setUserOpen((v) => !v)}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-elev-2 px-2 py-1 text-sm hover:border-accent/40"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-bg-elev-1 text-xs">
                {(me.full_name ?? me.email).slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden text-text-dim sm:inline">{me.full_name ?? me.email}</span>
              <span className="text-text-mute">▾</span>
            </button>
            {userOpen && (
              <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-bg-card p-1 shadow-xl">
                <div className="px-2 py-2 text-xs text-text-mute">{me.email}</div>
                <div className="my-1 border-t border-border" />
                {companies.length === 0 && (
                  <Link
                    href="/companies/new"
                    onClick={() => setUserOpen(false)}
                    className="block rounded px-2 py-2 text-sm text-accent hover:bg-bg-elev-2"
                  >
                    + Create your first company
                  </Link>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    setUserOpen(false);
                    await logout();
                  }}
                  className="block w-full rounded px-2 py-2 text-left text-sm hover:bg-bg-elev-2"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-strong"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

function HamburgerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}
