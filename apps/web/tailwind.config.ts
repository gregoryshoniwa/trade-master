import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bull: "#A8FF35",
        "bull-soft": "rgba(168, 255, 53, 0.1)",
        bear: "#FF6D5C",
        "bear-soft": "rgba(255, 109, 92, 0.1)",
        neutral: "#9CA3AF",
        critical: "#E91E63",
        warning: "#FBBF24",
        info: "#60A5FA",
        bg: "#0B0E14",
        "bg-elev-1": "#11151E",
        "bg-elev-2": "#171C28",
        "bg-card": "#14181F",
        border: "#1F2937",
        text: "#E5E7EB",
        "text-dim": "#9CA3AF",
        "text-mute": "#6B7280",
        "paper-mode": "#A8FF35",
        "live-mode": "#FF6D00",
      },
      fontFamily: {
        ui: ['"Inter Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', '"IBM Plex Mono"', "monospace"],
      },
      boxShadow: {
        glow: "0 0 80px rgba(168, 255, 53, 0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
