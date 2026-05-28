"""Per-agent Gemini Live voice — ephemeral-token, browser-direct.

We follow Google's recommended production pattern for Live API
(https://ai.google.dev/gemini-api/docs/ephemeral-tokens):

  1. Browser asks the api for a session.
  2. Api mints a short-lived ephemeral token, bound (`live_connect_constraints`)
     to this agent's exact model + voice + system prompt + tools. The api's
     long-lived GEMINI_API_KEY never leaves the server.
  3. Browser opens a WSS *directly* to
     `wss://generativelanguage.googleapis.com/.../BidiGenerateContentConstrained?access_token=<token>`.
     No more api WS proxy — which means no more "localhost:8000 WS not
     reachable from a tunneled browser" failure mode, and one fewer hop of
     audio latency.
  4. When the model calls a function, the browser POSTs the args to our
     `POST /voice/tool` so the tool runs in-process with the user's auth
     context, then sends `toolResponse` back over the same WSS it owns.
  5. On hang-up, the browser POSTs the assembled transcript to our
     `POST /voice/transcript` for `conversation_messages` + mem0 + usage
     accounting.

Endpoints exposed here:

  GET  /llm/voices                                — voice catalog
  POST /companies/{cid}/agents/{aid}/voice/session — mint ephemeral token
  POST /companies/{cid}/agents/{aid}/voice/tool    — run one tool call
  POST /companies/{cid}/agents/{aid}/voice/transcript — persist + usage at end

The previous WebSocket-proxy implementation lived at `WS /voice/connect`;
it's gone now. Same reason same-origin proxying was abandoned earlier — it
broke the moment the dashboard was reached through anything that didn't
forward port 8000 transparently to WS upgrades.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
import urllib.parse
import uuid
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.auth import CurrentAccount
from app.db import acquire
from app.llm import voices
from app.llm.gemini_adapter import _clean_schema
from app.llm.gemini_live import pick_model
from app.memory import memory_service
from app.routes.chat import _build_system_prompt, _ensure_member, _load_agent
from app.tools import ToolContext, available_tools, execute_tool
from app.usage import record as record_usage

log = logging.getLogger("trademaster.voice")

router = APIRouter(prefix="/companies/{company_id}/agents/{agent_id}", tags=["voice"])
voices_router = APIRouter(prefix="/llm", tags=["voice"])

# Constrained-token BidiGenerateContent endpoint. Locked to v1alpha because
# (a) auth_tokens.create only exists there, and (b) the Constrained variant
# is also v1alpha-only.
LIVE_WSS_BASE = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
)

# Token lifetimes. Google's defaults are 1 min to open + 30 min to talk; we
# match the defaults because users typically click "Call" right after the
# modal shows, and the longest hands-free chat we've seen in testing is ~10
# min. Bumping these doesn't make security worse — the token is bound to a
# single session config — but it makes a forgotten token live longer.
TOKEN_OPEN_WINDOW = dt.timedelta(minutes=2)
TOKEN_SESSION_WINDOW = dt.timedelta(minutes=30)


# ───────────────────────── schemas ──────────────────────────


class VoiceSessionOut(BaseModel):
    available: bool
    session_id: str
    token: str | None = None
    ws_url: str | None = None
    model: str
    voice_name: str
    voice_label: str
    voice_feel: str
    requires_gemini_brain: bool
    agent_brain_label: str
    expire_time: str | None = None


class VoiceDefOut(BaseModel):
    name: str
    label: str
    feel: str
    description: str


class ToolCallIn(BaseModel):
    session_id: str
    call_id: str | None = None
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class ToolCallOut(BaseModel):
    call_id: str | None
    name: str
    response: Any


class TranscriptTurnIn(BaseModel):
    role: Literal["user", "assistant"]
    text: str


class TranscriptIn(BaseModel):
    session_id: str
    duration_ms: int = 0
    model: str
    turns: list[TranscriptTurnIn] = Field(default_factory=list)


class TranscriptOut(BaseModel):
    persisted: bool
    user_chars: int
    assistant_chars: int


# ───────────────────────── catalog ──────────────────────────


@voices_router.get("/voices")
async def list_voices(account_id: CurrentAccount):
    _ = account_id
    return {
        "voices": [
            VoiceDefOut(name=v.name, label=v.label, feel=v.feel, description=v.description)
            for v in voices.CATALOG
        ],
        "default": voices.DEFAULT_VOICE,
    }


# ───────────────────────── session mint ──────────────────────────


def _tool_declarations() -> list[types.Tool] | None:
    tools = available_tools()
    if not tools:
        return None
    return [
        types.Tool(function_declarations=[
            types.FunctionDeclaration(
                name=t.name,
                description=t.description,
                parameters=_clean_schema(t.parameters),
            )
            for t in tools
        ]),
    ]


def _build_live_config(
    *, agent: dict[str, Any], system_prompt: str, voice_name: str,
) -> types.LiveConnectConfig:
    return types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name),
            ),
        ),
        system_instruction=types.Content(parts=[types.Part(text=system_prompt)]),
        tools=_tool_declarations(),
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )


@router.post("/voice/session", response_model=VoiceSessionOut)
async def mint_voice_session(
    company_id: UUID, agent_id: UUID, account_id: CurrentAccount,
):
    """Mint an ephemeral Gemini Live token bound to this agent's session.

    The token expires in ~2 min for opening + 30 min once opened; it can
    only ever open *this* agent's session — different model/voice/prompt/tools
    can't be requested with the same token because they're locked into the
    `live_connect_constraints`. The browser then connects to Gemini WSS
    directly using `access_token=<token>`."""
    if not os.getenv("GEMINI_API_KEY"):
        # Surface unavailable cleanly so the modal can show a real message.
        return VoiceSessionOut(
            available=False, session_id=uuid.uuid4().hex,
            model="", voice_name="", voice_label="", voice_feel="",
            requires_gemini_brain=True, agent_brain_label="",
        )

    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        agent = await _load_agent(conn, company_id, agent_id)

    model, requires_swap = pick_model(dict(agent))
    voice = voices.get(agent["voice_id"])

    # Pull a few memories so the system prompt feels continuous across
    # sessions. Empty query gets the most-relevant; future iteration could
    # update live.
    memories = []
    try:
        memories = await memory_service.search(
            company_id=company_id, account_id=account_id,
            agent_id=agent_id, query="", limit=5,
        )
    except Exception:
        log.debug("mem0 recall failed; continuing without")

    company_row = await _get_company_name(company_id)
    user_row = await _get_user(account_id, company_id)
    system_prompt = _build_system_prompt(
        agent, company_row["name"], user_row.get("full_name"),
        user_row.get("title"), memories,
    )

    cfg = _build_live_config(
        agent=dict(agent), system_prompt=system_prompt, voice_name=voice.name,
    )

    now = dt.datetime.now(tz=dt.timezone.utc)
    client = genai.Client(
        api_key=os.environ["GEMINI_API_KEY"],
        http_options={"api_version": "v1alpha"},
    )
    try:
        token_obj = await client.aio.auth_tokens.create(
            config=types.CreateAuthTokenConfig(
                uses=1,
                expire_time=now + TOKEN_SESSION_WINDOW,
                new_session_expire_time=now + TOKEN_OPEN_WINDOW,
                live_connect_constraints=types.LiveConnectConstraints(
                    model=model, config=cfg,
                ),
                http_options={"api_version": "v1alpha"},
            ),
        )
    except Exception as e:
        log.exception("auth_tokens.create failed")
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Gemini token mint failed: {str(e)[:200]}",
        )

    token_name = getattr(token_obj, "name", None) or ""
    ws_url = f"{LIVE_WSS_BASE}?access_token={urllib.parse.quote(token_name)}"
    return VoiceSessionOut(
        available=True,
        session_id=uuid.uuid4().hex,
        token=token_name,
        ws_url=ws_url,
        model=model,
        voice_name=voice.name,
        voice_label=voice.label,
        voice_feel=voice.feel,
        requires_gemini_brain=requires_swap,
        agent_brain_label=f"{agent['llm_provider']}/{agent['llm_model']}",
        expire_time=(now + TOKEN_SESSION_WINDOW).isoformat(),
    )


# ───────────────────────── tool exec (browser → api) ──────────────────────────


@router.post("/voice/tool", response_model=ToolCallOut)
async def run_voice_tool(
    company_id: UUID, agent_id: UUID, account_id: CurrentAccount,
    body: ToolCallIn,
):
    """Run one tool the model called for. Browser sends function name +
    args; we dispatch through the same tool registry the text chat uses
    so voice and chat share permissions, scoping, and side-effects."""
    ctx = ToolContext(
        company_id=company_id, account_id=account_id, agent_id=agent_id,
    )
    try:
        result_json = await execute_tool(body.name, body.arguments, ctx)
    except Exception as e:
        log.exception("voice tool %s failed", body.name)
        return ToolCallOut(call_id=body.call_id, name=body.name, response={"error": str(e)[:300]})
    try:
        result = json.loads(result_json)
    except Exception:
        result = {"raw": result_json}
    return ToolCallOut(call_id=body.call_id, name=body.name, response=result)


# ───────────────────────── end-of-session persistence ──────────────────────────


@router.post("/voice/transcript", response_model=TranscriptOut)
async def submit_voice_transcript(
    company_id: UUID, agent_id: UUID, account_id: CurrentAccount,
    body: TranscriptIn, bg: BackgroundTasks,
):
    """Persist a finished voice session: write conversation_messages,
    fire-and-forget mem0 update, record cost as `kind="voice"`. Idempotent
    on no transcript — empty calls just return zeros without polluting
    chat history."""
    user_text = " ".join(t.text for t in body.turns if t.role == "user").strip()
    agent_text = " ".join(t.text for t in body.turns if t.role == "assistant").strip()
    if not user_text and not agent_text:
        return TranscriptOut(persisted=False, user_chars=0, assistant_chars=0)

    await _persist_voice_turn(
        company_id=company_id, account_id=account_id, agent_id=agent_id,
        user_text=user_text, agent_text=agent_text,
    )

    # Usage row — duration as the cost proxy because streaming audio doesn't
    # surface token counts. The registry has a per-second price for the
    # Live model.
    try:
        await record_usage(
            company_id=company_id, account_id=account_id, agent_id=agent_id,
            provider="google", model=body.model,
            input_tokens=max(0, body.duration_ms // 1000), output_tokens=0,
            latency_ms=body.duration_ms, kind="voice",
        )
    except Exception:
        log.debug("voice usage record failed; continuing")

    # mem0 — best effort, background.
    async def _mem_add():
        try:
            msgs = []
            if user_text:  msgs.append({"role": "user", "content": user_text})
            if agent_text: msgs.append({"role": "assistant", "content": agent_text})
            if msgs:
                await memory_service.add_turn(
                    company_id=company_id, account_id=account_id,
                    agent_id=agent_id, messages=msgs, metadata={"voice": True},
                )
        except Exception:
            log.debug("mem0 add (voice) failed; continuing")
    bg.add_task(_mem_add)

    return TranscriptOut(
        persisted=True,
        user_chars=len(user_text), assistant_chars=len(agent_text),
    )


# ─────────────────────── helpers ───────────────────────


async def _get_company_name(company_id: UUID) -> dict[str, Any]:
    async with acquire() as conn:
        row = await conn.fetchrow("SELECT name FROM companies WHERE id = $1", company_id)
    return dict(row) if row else {"name": "this company"}


async def _get_user(account_id: UUID, company_id: UUID) -> dict[str, Any]:
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT a.full_name, m.title
            FROM accounts a
            LEFT JOIN company_members m ON m.account_id = a.id AND m.company_id = $2
            WHERE a.id = $1
            """,
            account_id, company_id,
        )
    return dict(row) if row else {}


async def _persist_voice_turn(
    *, company_id: UUID, account_id: UUID, agent_id: UUID,
    user_text: str, agent_text: str,
) -> None:
    """Save a voice session as a normal conversation_messages turn so it
    shows up in the chat history list."""
    async with acquire() as conn:
        conv_id = await conn.fetchval(
            """
            SELECT id FROM conversations
            WHERE company_id=$1 AND account_id=$2 AND agent_id=$3
            ORDER BY last_message_at DESC NULLS LAST LIMIT 1
            """,
            company_id, account_id, agent_id,
        )
        if conv_id is None:
            conv_id = await conn.fetchval(
                """
                INSERT INTO conversations (company_id, account_id, agent_id, title)
                VALUES ($1, $2, $3, $4)
                RETURNING id
                """,
                company_id, account_id, agent_id,
                f"🎙 {user_text[:60]}" if user_text else "🎙 Voice chat",
            )
        if user_text:
            await conn.execute(
                """
                INSERT INTO conversation_messages
                    (conversation_id, company_id, role, content, metadata)
                VALUES ($1, $2, 'user', $3, '{"voice":true}'::jsonb)
                """,
                conv_id, company_id, user_text,
            )
        if agent_text:
            await conn.execute(
                """
                INSERT INTO conversation_messages
                    (conversation_id, company_id, role, content, metadata)
                VALUES ($1, $2, 'assistant', $3, '{"voice":true}'::jsonb)
                """,
                conv_id, company_id, agent_text,
            )
        await conn.execute(
            "UPDATE conversations SET last_message_at = now() WHERE id = $1", conv_id,
        )
