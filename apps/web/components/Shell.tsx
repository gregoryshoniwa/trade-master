"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import { useAuth } from "@/lib/auth";

// Routes that intentionally bypass the app chrome (sidebar + topbar). They
// render full-bleed so they look like real auth screens instead of an
// empty dashboard with a form floating in the middle.
const AUTH_ROUTES = ["/login", "/signup"];

// Public marketing routes — visible without login. We don't redirect to
// /login when the visitor is logged out on these; they're the front door
// for new customers. The dashboard at `/` is also a marketing landing
// when there's no session (the page component branches on `me`).
const PUBLIC_ROUTES = ["/", "/pricing"];

function isAuthRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return AUTH_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isPublicRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_ROUTES.some((p) => pathname === p);
}

/** App shell: persistent left sidebar (desktop) + slim top bar + scrollable
 *  main content. On mobile the sidebar collapses behind a slide-over drawer
 *  triggered from the top bar's hamburger. The whole frame is fixed-height
 *  so scrolling happens inside <main> — the chrome doesn't move with content,
 *  which is the standard trading-platform layout.
 *
 *  Auth pages (`/login`, `/signup`) render outside this chrome — a half-empty
 *  sidebar next to a login form is the kind of thing that screams "internal
 *  tool, not finished." We also handle the redirect dance here so every
 *  protected route doesn't have to reimplement it. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, me } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const authRoute = isAuthRoute(pathname);
  const publicRoute = isPublicRoute(pathname);

  // Close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Redirect dance:
  //   - logged out + non-public/non-auth route → /login
  //   - logged in  + auth route                → /
  // Public routes (landing, pricing) are accessible in both states; their
  // page components branch internally on `me`.
  useEffect(() => {
    if (loading) return;
    if (!me && !authRoute && !publicRoute) {
      router.replace("/login");
    } else if (me && authRoute) {
      router.replace("/");
    }
  }, [loading, me, authRoute, publicRoute, router]);

  // Full-bleed auth layout — no sidebar, no topbar, no padding from us.
  if (authRoute) {
    return <main className="h-screen overflow-y-auto bg-bg">{children}</main>;
  }

  // Public routes for logged-out visitors render full-bleed too — the
  // landing page is its own visual world and shouldn't be wrapped in the
  // app chrome that screams "internal tool."
  if (!loading && !me && publicRoute) {
    return <main className="h-screen overflow-y-auto bg-bg">{children}</main>;
  }

  // While auth is resolving (or while a redirect is in flight) avoid
  // flashing the dashboard chrome to a not-yet-signed-in user.
  if (loading || !me) {
    return (
      <main className="grid h-screen place-items-center bg-bg text-sm text-text-mute">
        Loading…
      </main>
    );
  }

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
        {/* overflow-x-hidden so a stray wide child can't push the whole shell.
            Vertical scroll happens here so the chrome stays put. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-bg">{children}</main>
      </div>
    </div>
  );
}
