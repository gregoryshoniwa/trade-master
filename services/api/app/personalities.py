"""Personality presets from PLAN §7.1.

Each preset configures a bundle of risk + frequency + confidence knobs.
The CEO can pick one and tune individual fields, or pick 'custom' for full
manual control. Personality drives how aggressively an Agent acts; trade
selection mode (§7.3) drives how it picks among candidate setups.
"""

from typing import TypedDict

STRATEGIES = ["trend_following", "breakout", "support_resistance", "mean_reversion", "price_action"]


class Personality(TypedDict):
    key: str
    label: str
    icon: str
    description: str
    kelly_fraction: float
    min_confidence_threshold: float
    min_payoff_ratio: float
    max_trades_per_day: int
    target_holding_secs: int | None


PRESETS: dict[str, Personality] = {
    "sniper": {
        "key": "sniper",
        "label": "Sniper",
        "icon": "⚡",
        "description": "Few high-conviction big-edge trades. Patient, precise.",
        "kelly_fraction": 0.50,
        "min_confidence_threshold": 0.75,
        "min_payoff_ratio": 2.5,
        "max_trades_per_day": 3,
        "target_holding_secs": 45 * 60,  # 30-60 min, target mid
    },
    "scalper": {
        "key": "scalper",
        "label": "Scalper",
        "icon": "🔁",
        "description": "Many small wins, tight stops, high frequency.",
        "kelly_fraction": 0.10,
        "min_confidence_threshold": 0.55,
        "min_payoff_ratio": 1.2,
        "max_trades_per_day": 50,
        "target_holding_secs": 75,  # 30-120s
    },
    "hunter": {
        "key": "hunter",
        "label": "Hunter",
        "icon": "🎯",
        "description": "Medium frequency, hunts for highest-EV setups.",
        "kelly_fraction": 0.30,
        "min_confidence_threshold": 0.65,
        "min_payoff_ratio": 2.0,
        "max_trades_per_day": 12,
        "target_holding_secs": 20 * 60,
    },
    "guardian": {
        "key": "guardian",
        "label": "Guardian",
        "icon": "🛡",
        "description": "Capital preservation. Only the safest setups.",
        "kelly_fraction": 0.10,
        "min_confidence_threshold": 0.70,
        "min_payoff_ratio": 1.5,
        "max_trades_per_day": 8,
        "target_holding_secs": 10 * 60,
    },
    "balanced": {
        "key": "balanced",
        "label": "Balanced",
        "icon": "⚖",
        "description": "Default — versatile mix of frequency and conviction.",
        "kelly_fraction": 0.25,
        "min_confidence_threshold": 0.60,
        "min_payoff_ratio": 1.5,
        "max_trades_per_day": 20,
        "target_holding_secs": 10 * 60,
    },
}


def apply_preset(preset_key: str) -> dict:
    """Return parameter overrides for a given personality preset.
    Empty dict for 'custom' (caller supplies everything)."""
    if preset_key == "custom":
        return {}
    if preset_key not in PRESETS:
        raise ValueError(f"unknown personality preset: {preset_key}")
    p = PRESETS[preset_key]
    return {
        "kelly_fraction": p["kelly_fraction"],
        "min_confidence_threshold": p["min_confidence_threshold"],
        "min_payoff_ratio": p["min_payoff_ratio"],
        "max_trades_per_day": p["max_trades_per_day"],
        "target_holding_secs": p["target_holding_secs"],
    }


# ─────────────────────── starter Agent set ───────────────────────
# Seeded on Company creation per PLAN §6.4.

STARTER_AGENTS: list[dict] = [
    {
        "name": "Alpha",
        "role": "manager",
        "personality": "balanced",
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-6",
        "voice_id": "Aoede",
        "strategies": [],  # manager doesn't own a strategy; it picks among employees
    },
    {
        "name": "Trendy",
        "role": "employee",
        "personality": "hunter",
        "llm_provider": "google",
        "llm_model": "gemini-2.5-flash",
        "voice_id": "Charon",
        "strategies": ["trend_following"],
    },
    {
        "name": "Brakey",
        "role": "employee",
        "personality": "hunter",
        "llm_provider": "google",
        "llm_model": "gemini-2.5-flash",
        "voice_id": "Fenrir",
        "strategies": ["breakout"],
    },
    {
        "name": "Rocky",
        "role": "employee",
        "personality": "balanced",
        "llm_provider": "google",
        "llm_model": "gemini-2.5-flash",
        "voice_id": "Puck",
        "strategies": ["support_resistance"],
    },
    {
        "name": "Rev",
        "role": "employee",
        "personality": "guardian",
        "llm_provider": "google",
        "llm_model": "gemini-2.5-flash",
        "voice_id": "Kore",
        "strategies": ["mean_reversion"],
    },
    {
        "name": "Action",
        "role": "employee",
        "personality": "scalper",
        "llm_provider": "google",
        "llm_model": "gemini-2.5-flash",
        "voice_id": "Aoede",
        "strategies": ["price_action"],
    },
    {
        "name": "Scout",
        "role": "research",
        "personality": "balanced",
        "llm_provider": "google",
        "llm_model": "gemini-2.5-flash",
        "voice_id": "Charon",
        "strategies": [],
    },
]
