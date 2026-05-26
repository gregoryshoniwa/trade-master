import type { Personality } from "./api";

export const PERSONALITY_ICON: Record<Personality, string> = {
  sniper: "⚡",
  scalper: "🔁",
  hunter: "🎯",
  guardian: "🛡",
  balanced: "⚖",
  custom: "✦",
};

export const ROLE_LABEL: Record<"manager" | "employee" | "research", string> = {
  manager: "Manager",
  employee: "Employee",
  research: "Research",
};

export const STRATEGY_LABEL: Record<string, string> = {
  trend_following: "Trend",
  breakout: "Breakout & Retest",
  support_resistance: "Support & Resistance",
  mean_reversion: "Mean Reversion",
  price_action: "Price Action",
};

export const ALL_STRATEGIES = [
  "trend_following",
  "breakout",
  "support_resistance",
  "mean_reversion",
  "price_action",
];

export const DEFAULT_LLM_BY_ROLE: Record<
  "manager" | "employee" | "research",
  { provider: string; model: string }
> = {
  manager: { provider: "anthropic", model: "claude-sonnet-4-6" },
  employee: { provider: "google", model: "gemini-2.5-flash" },
  research: { provider: "google", model: "gemini-2.5-flash" },
};
