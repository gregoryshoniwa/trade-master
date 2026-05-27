"use client";

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/lib/auth";

export default function Nav() {
  const { loading, me, companies, activeCompanyId, setActiveCompany, logout } =
    useAuth();
  const [open, setOpen] = useState(false);
  const [companiesOpen, setCompaniesOpen] = useState(false);

  const active = companies.find((c) => c.id === activeCompanyId) ?? null;

  return (
    <nav className="border-b border-border bg-bg-elev-1">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80">
            <div className="h-7 w-7 rounded-md bg-bull shadow-glow" />
            <span className="text-base font-semibold tracking-tight">
              TradeMaster
            </span>
          </Link>

          {active && (
            <>
            <Link
              href="/agents"
              className="ml-3 hidden text-sm text-text-dim hover:text-text sm:inline"
            >
              Agents
            </Link>
            <Link
              href="/tiers"
              className="hidden text-sm text-text-dim hover:text-text sm:inline"
            >
              Tiers
            </Link>
            <Link
              href="/members"
              className="hidden text-sm text-text-dim hover:text-text sm:inline"
            >
              Members
            </Link>

            <div className="relative ml-3">
              <button
                type="button"
                onClick={() => setCompaniesOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:border-bull/40"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: active.brand_color ?? "#A8FF35",
                  }}
                />
                <span>{active.name}</span>
                <span className="num text-text-mute">
                  · T{active.current_asset_tier}
                </span>
                <span className="text-text-mute">▾</span>
              </button>
              {companiesOpen && (
                <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-bg-card p-1 shadow-xl">
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
                        style={{ backgroundColor: c.brand_color ?? "#A8FF35" }}
                      />
                      <span className="flex-1">{c.name}</span>
                      <span className="num text-xs text-text-mute">{c.role}</span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-border" />
                  <Link
                    href="/companies/new"
                    onClick={() => setCompaniesOpen(false)}
                    className="block rounded px-2 py-2 text-sm text-bull hover:bg-bg-elev-2"
                  >
                    + Create new company
                  </Link>
                </div>
              )}
            </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {loading ? (
            <span className="text-xs text-text-mute">…</span>
          ) : me ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-border bg-bg-card px-3 py-1.5 text-sm hover:border-bull/40"
              >
                <span className="h-6 w-6 rounded-full bg-bg-elev-2 text-center text-xs leading-6">
                  {(me.full_name ?? me.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{me.full_name ?? me.email}</span>
                <span className="text-text-mute">▾</span>
              </button>
              {open && (
                <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-bg-card p-1 shadow-xl">
                  <div className="px-2 py-2 text-xs text-text-mute">
                    {me.email}
                  </div>
                  <div className="my-1 border-t border-border" />
                  {companies.length === 0 && (
                    <Link
                      href="/companies/new"
                      onClick={() => setOpen(false)}
                      className="block rounded px-2 py-2 text-sm text-bull hover:bg-bg-elev-2"
                    >
                      + Create your first company
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      setOpen(false);
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
              className="rounded-md bg-bull px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
