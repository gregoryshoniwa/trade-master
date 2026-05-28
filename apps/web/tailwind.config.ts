import type { Config } from "tailwindcss";

// All colors resolve to CSS variables defined in app/globals.css under
// :root[data-theme="dark"] / :root[data-theme="light"]. Flip the theme on
// <html data-theme="..."> and the whole tree re-skins — no rebuild.
//
// Class names stay backwards-compatible (bg-bg-card, text-text-mute, bull,
// bear, etc.) so existing components don't need a churn pass.

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic colors use the RGB-triplet pattern so Tailwind alpha
        // modifiers (e.g. `border-bull/30`) compose correctly.
        bull: "rgb(var(--color-bull-rgb) / <alpha-value>)",
        "bull-soft": "var(--color-bull-soft)",
        bear: "rgb(var(--color-bear-rgb) / <alpha-value>)",
        "bear-soft": "var(--color-bear-soft)",
        critical: "rgb(var(--color-critical-rgb) / <alpha-value>)",
        warning: "rgb(var(--color-warning-rgb) / <alpha-value>)",
        "warning-soft": "var(--color-warning-soft)",
        info: "rgb(var(--color-info-rgb) / <alpha-value>)",
        accent: "rgb(var(--color-accent-rgb) / <alpha-value>)",
        "accent-soft": "var(--color-accent-soft)",
        "accent-strong": "var(--color-accent-strong)",
        neutral: "var(--color-neutral)",
        // Surfaces and text are never alpha-modified, so flat hex is fine.
        bg: "var(--color-bg)",
        "bg-elev-1": "var(--color-bg-elev-1)",
        "bg-elev-2": "var(--color-bg-elev-2)",
        "bg-card": "var(--color-bg-card)",
        border: "var(--color-border)",
        text: "var(--color-text)",
        "text-dim": "var(--color-text-dim)",
        "text-mute": "var(--color-text-mute)",
        // Mode pills keep semantic meaning: a "paper" badge reads positive
        // in either palette; "live" stays warning-orange.
        "paper-mode": "rgb(var(--color-bull-rgb) / <alpha-value>)",
        "live-mode": "rgb(var(--color-warning-rgb) / <alpha-value>)",
      },
      fontFamily: {
        ui: ['"Inter Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', '"IBM Plex Mono"', "monospace"],
      },
      boxShadow: {
        glow: "var(--shadow-glow)",
      },
    },
  },
  plugins: [],
};

export default config;
