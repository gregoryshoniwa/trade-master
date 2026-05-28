"""Curated catalog of Gemini Live prebuilt voices.

Gemini Live ships ~30 prebuilt voice IDs (Aoede, Charon, Fenrir, Kore,
Puck, Zephyr, Leda, Orus, etc.). Showing all of them in a single dropdown
is overwhelming; this curated set picks 10 distinct ones grouped by feel
so the CEO can pick a voice that matches each agent's personality without
auditioning every option.

If a future iteration adds previews (pre-rendered MP3 samples), they go
in `apps/web/public/audio/voices/{name}.mp3` and the picker can wire them
up. Phase 1 is text-only.
"""

from dataclasses import dataclass
from typing import Literal

Feel = Literal["warm", "neutral", "cool", "energetic"]


@dataclass(frozen=True)
class VoiceDef:
    name: str           # Gemini Live voice identifier
    label: str          # human-friendly display label
    feel: Feel
    description: str    # one-line characterisation


CATALOG: list[VoiceDef] = [
    # Warm — friendly, conversational
    VoiceDef("Aoede",   "Aoede",   "warm",       "Warm, friendly default — good all-rounder."),
    VoiceDef("Kore",    "Kore",    "warm",       "Soft, calm female voice; good for guardian/scalper personalities."),
    VoiceDef("Leda",    "Leda",    "warm",       "Reassuring female voice with measured pacing."),

    # Neutral — clear, professional
    VoiceDef("Charon",  "Charon",  "neutral",    "Crisp male voice, even pacing — sounds like a senior trader."),
    VoiceDef("Orus",    "Orus",    "neutral",    "Even-toned, professional; pairs well with analytical personalities."),

    # Cool — composed, slightly clinical
    VoiceDef("Despina", "Despina", "cool",       "Cool, composed female — good for sniper / risk-aware agents."),
    VoiceDef("Algieba", "Algieba", "cool",       "Slightly clinical, very clear diction."),

    # Energetic — upbeat
    VoiceDef("Puck",    "Puck",    "energetic",  "Upbeat male voice with a touch of energy."),
    VoiceDef("Fenrir",  "Fenrir",  "energetic",  "Strong, confident male voice — assertive delivery."),
    VoiceDef("Zephyr",  "Zephyr",  "energetic",  "Light, breezy female voice with a quick rhythm."),
]

BY_NAME: dict[str, VoiceDef] = {v.name: v for v in CATALOG}

DEFAULT_VOICE = "Aoede"


def is_known(name: str | None) -> bool:
    return name in BY_NAME


def get(name: str | None) -> VoiceDef:
    """Return the named voice, or the default if missing/unknown."""
    if name and name in BY_NAME:
        return BY_NAME[name]
    return BY_NAME[DEFAULT_VOICE]
