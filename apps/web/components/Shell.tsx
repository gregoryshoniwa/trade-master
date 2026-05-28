"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";

/** App shell: persistent left sidebar (desktop) + slim top bar + scrollable
 *  main content. On mobile the sidebar collapses behind a slide-over drawer
 *  triggered from the top bar's hamburger. The whole frame is fixed-height
 *  so scrolling happens inside <main> — the chrome doesn't move with content,
 *  which is the standard trading-platform layout. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <div className="absolute inset-y-0 left-0 w-56 bg-bg-elev-1 shadow-xl">
            <Sidebar mobile />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMobileMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-auto bg-bg">{children}</main>
      </div>
    </div>
  );
}
