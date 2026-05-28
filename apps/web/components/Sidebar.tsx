"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";

const STORAGE_KEY = "tm.sidebar.collapsed";

type NavItem = { href: string; label: string; icon: React.ReactNode };

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Trade",
    items: [
      { href: "/", label: "Dashboard", icon: <DashboardIcon /> },
      { href: "/approvals", label: "Approvals", icon: <CheckIcon /> },
      { href: "/postmortems", label: "Postmortems", icon: <FileIcon /> },
      { href: "/calendar", label: "Calendar", icon: <CalendarIcon /> },
    ],
  },
  {
    title: "Agents",
    items: [
      { href: "/agents", label: "Agents", icon: <UsersIcon /> },
      { href: "/payroll", label: "Payroll", icon: <CoinIcon /> },
    ],
  },
  {
    title: "Company",
    items: [
      { href: "/members", label: "Members", icon: <PersonIcon /> },
      { href: "/tiers", label: "Tiers", icon: <LayersIcon /> },
    ],
  },
];

type Props = {
  /** When true, render unconditionally (for the mobile drawer). The default
   *  desktop sidebar is hidden below the md breakpoint. */
  mobile?: boolean;
};

export default function Sidebar({ mobile = false }: Props) {
  const pathname = usePathname() ?? "/";
  const { me } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch { /* private mode */ }
  }, []);

  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch { /* private mode */ }
      return next;
    });
  }

  // Mobile drawer renders unconditionally; the default desktop sidebar
  // hides below the md breakpoint.
  const visibility = mobile ? "flex" : "hidden md:flex";
  const width = mobile ? "w-56" : collapsed ? "md:w-14" : "md:w-56";

  // If signed-out, render a minimal sidebar (brand only). Layout still
  // benefits from the structural slot.
  if (!me) {
    return (
      <aside className={`${visibility} ${mobile ? "w-56" : "w-56"} shrink-0 flex-col border-r border-border bg-bg-elev-1`}>
        <Brand collapsed={false} />
      </aside>
    );
  }

  return (
    <aside
      className={`${visibility} ${width} shrink-0 flex-col border-r border-border bg-bg-elev-1 transition-[width] duration-150`}
    >
      <Brand collapsed={collapsed} />

      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {SECTIONS.map((section) => (
          <div key={section.title} className="mb-4">
            {!collapsed && (
              <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-text-mute">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm transition ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-text-dim hover:bg-bg-elev-2 hover:text-text"
                  } ${collapsed ? "justify-center" : ""}`}
                >
                  <span className="h-4 w-4 shrink-0">{item.icon}</span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {!mobile && (
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="border-t border-border px-2 py-2 text-text-mute transition hover:bg-bg-elev-2 hover:text-text"
        >
          <span className="flex items-center justify-center gap-2 text-xs">
            {collapsed ? <ChevronRightIcon /> : <><ChevronLeftIcon /><span>Collapse</span></>}
          </span>
        </button>
      )}
    </aside>
  );
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex h-14 items-center gap-2 border-b border-border px-3 hover:opacity-80">
      <div className="h-7 w-7 shrink-0 rounded-md bg-accent shadow-glow" />
      {!collapsed && <span className="text-sm font-semibold tracking-tight">TradeMaster</span>}
    </Link>
  );
}

/* ── Icons (inline SVG; no extra deps) ───────────────────────────────── */

function svgProps() {
  return {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}
function DashboardIcon() {
  return <svg {...svgProps()}><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>;
}
function CheckIcon() {
  return <svg {...svgProps()}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
}
function FileIcon() {
  return <svg {...svgProps()}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>;
}
function CalendarIcon() {
  return <svg {...svgProps()}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}
function UsersIcon() {
  return <svg {...svgProps()}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function CoinIcon() {
  return <svg {...svgProps()}><circle cx="12" cy="12" r="10"/><path d="M12 6v12M8 10h6a2 2 0 1 1 0 4H10a2 2 0 1 0 0 4h6"/></svg>;
}
function PersonIcon() {
  return <svg {...svgProps()}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
}
function LayersIcon() {
  return <svg {...svgProps()}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>;
}
function ChevronLeftIcon() {
  return <svg {...svgProps()} width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>;
}
function ChevronRightIcon() {
  return <svg {...svgProps()} width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>;
}
