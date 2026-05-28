"""Gemini Live session config builder.

We do NOT mint ephemeral tokens here. The api opens the Gemini Live
WebSocket itself (using GEMINI_API_KEY) and proxies the session for the
browser. That keeps the key off the wire, simplifies tool execution (it
runs in-process), and avoids SDK-version dependency on auth_tokens.create.

This module just turns an agent row + a system prompt into the
LiveConnectConfig that gets passed to `client.aio.live.connect(...)`.
"""

from __future__ import annotations

import os
from typing import Any

from google import genai
from google.genai import types

from app.llm.gemini_adapter import _clean_schema
from app.llm.voices import DEFAULT_VOICE, get as get_voice

# Default Live model. The older `gemini-2.0-flash-live-001` was deprecated
# off v1beta in early 2026 — Google now ships native-audio under the 2.5
# family. The `-latest` alias rolls forward automatically; we don't have
# to bump a pin every time a new preview lands.
LIVE_MODEL_DEFAULT = "gemini-2.5-flash-native-audio-latest"

# Models that support the Live API directly. If the agent's text-chat model
# is one of these AND the provider is Google, we use the agent's actual
# model so the voice persona matches the text persona. Otherwise we fall
# back to LIVE_MODEL_DEFAULT and surface a "voice via Gemini Live" badge.
LIVE_CAPABLE_MODELS: set[str] = {
    "gemini-2.5-flash-native-audio-latest",
    "gemini-2.5-flash-native-audio-preview-09-2025",
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-3.1-flash-live-preview",
}


def pick_model(agent: dict[str, Any]) -> tuple[str, bool]:
    """Returns (model_id, requires_gemini_brain). The second flag is True
    when we had to swap to the default Gemini Live model because the
    agent's text-chat brain isn't a Live-capable Gemini variant."""
    if agent.get("llm_provider") == "google":
        m = agent.get("llm_model", "")
        if m in LIVE_CAPABLE_MODELS:
            return m, False
        # Even Gemini text models that aren't Live-capable need the swap.
    return LIVE_MODEL_DEFAULT, True


def build_session_config(
    *,
    agent: dict[str, Any],
    system_prompt: str,
    tools: list,  # list[ToolDef] from app.llm.base
) -> types.LiveConnectConfig:
    """Compose the LiveConnectConfig for a session. Same system prompt +
    same tools as a text chat so the voice agent has the same powers."""
    voice = get_voice(agent.get("voice_id") or DEFAULT_VOICE)

    tool_objects = []
    if tools:
        tool_objects = [
            types.Tool(function_declarations=[
                types.FunctionDeclaration(
                    name=t.name,
                    description=t.description,
                    parameters=_clean_schema(t.parameters),
                )
                for t in tools
            ])
        ]

    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice.name),
            ),
        ),
        system_instruction=types.Content(parts=[types.Part(text=system_prompt)]),
        tools=tool_objects or None,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )


def get_client() -> genai.Client:
    """One client per api process; the SDK manages its own pool."""
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
