"use client";

/**
 * Standalone /pricing page — accessible to logged-in and logged-out
 * visitors. Reuses the Landing component's pricing section by scrolling
 * to it on mount, so we have one source of truth for tier definitions
 * and copy.
 */

import { useEffect } from "react";

import Landing from "@/components/Landing";

export default function PricingPage() {
  useEffect(() => {
    // Defer one tick so the layout has painted before we scroll.
    const id = window.requestAnimationFrame(() => {
      const el = document.getElementById("pricing");
      if (el) el.scrollIntoView({ behavior: "instant", block: "start" });
    });
    return () => window.cancelAnimationFrame(id);
  }, []);
  return <Landing />;
}
