"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "tm.theme";

/** Inline-able script that picks the initial theme before React hydrates.
 *  Use in app/layout.tsx via `dangerouslySetInnerHTML` so there's no flash
 *  of wrong palette on first paint. localStorage wins; otherwise we follow
 *  the user's OS preference; default dark. */
export const NO_FLASH_INIT = `
(function () {
  try {
    var t = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    if (t !== "dark" && t !== "light") {
      t = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light" : "dark";
    }
    document.documentElement.setAttribute("data-theme", t);
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
`;

export function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" ? "light" : "dark";
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    /* localStorage can throw in private mode */
  }
}

/** Subscribe to theme changes (toggle, system change). Components that have
 *  to imperatively recolor — most notably the lightweight-charts canvas —
 *  read CSS vars in the effect. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    // First sync after hydration, in case the inline script picked something
    // different from our default state.
    setTheme(readTheme());

    const obs = new MutationObserver(() => setTheme(readTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return theme;
}

/** Read a CSS variable from <html> at call time. Useful for non-CSS
 *  consumers like canvas charts. */
export function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
