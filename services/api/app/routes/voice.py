"""Per-agent Gemini Live voice proxy.

Three endpoints:

  GET  /companies/{cid}/agents/{aid}/voice/session   — metadata for the modal
  WS   /companies/{cid}/agents/{aid}/voice/connect   — bidirectional audio
  GET  /llm/voices                                    — curated voice catalog

The browser opens the WS to *us*, not directly to Google. We hold the
GEMINI_API_KEY and open the Gemini Live WSS server-side. Tool calls fire
in-process. The browser only ever talks to localhost.

Wire protocol (text frames, JSON-tagged):

  browser → api:
    {type: "audio", data: <base64 PCM int16 16kHz mono>}
    {type: "end_turn"}                       — explicit end-of-utterance
    {type: "bye"}                            — close cleanly

  api → browser:
    {type: "ready", voice, model, requires_gemini_brain}
    {type: "audio", data: <base64 PCM int16 24kHz mono>}
    {type: "transcript", role: "user"|"assistant", text}
    {type: "tool_call", name, arguments}     — informational
    {type: "error", message}
    {type: "closed"}
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import uuid
from typing import Any
from uuid import UUID

import asyncpg
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel

from app.auth import CurrentAccount, decode_session_jwt
from app.memory import memory_service
from app.db import acquire
from app.llm import voices
from app.llm.gemini_live import build_session_config, get_client, pick_model
from app.routes.chat import _build_system_prompt, _ensure_member, _load_agent
from app.tools import ToolContext, available_tools, execute_tool
from app.usage import record as record_usage

log = logging.getLogger("trademaster.voice")

router = APIRouter(prefix="/companies/{company_id}/agents/{agent_id}", tags=["voice"])
voices_router = APIRouter(prefix="/llm", tags=["voice"])


# ───────────────────────── schemas ──────────────────────────


class VoiceSessionInfo(BaseModel):
    available: bool
    voice_name: str
    voice_label: str
    voice_feel: str
    model: str
    requires_gemini_brain: bool   # True when text brain ≠ Gemini Live
    agent_brain_label: str        # e.g. "claude-sonnet-4-6"


class VoiceDefOut(BaseModel):
    name: str
    label: str
    feel: str
    description: str


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


# ───────────────────────── session metadata ──────────────────────────


@router.get("/voice/session", response_model=VoiceSessionInfo)
async def voice_session_info(
    company_id: UUID, agent_id: UUID, account_id: CurrentAccount,
):
    if not os.getenv("GEMINI_API_KEY"):
        # Surface the unavailable state cleanly instead of 500'ing.
        return VoiceSessionInfo(
            available=False, voice_name="", voice_label="", voice_feel="",
            model="", requires_gemini_brain=True, agent_brain_label="",
        )
    async with acquire() as conn:
        await _ensure_member(conn, company_id, account_id)
        agent = await _load_agent(conn, company_id, agent_id)
    model, swap = pick_model(dict(agent))
    voice = voices.get(agent["voice_id"])
    return VoiceSessionInfo(
        available=True,
        voice_name=voice.name, voice_label=voice.label, voice_feel=voice.feel,
        model=model, requires_gemini_brain=swap,
        agent_brain_label=f"{agent['llm_provider']}/{agent['llm_model']}",
    )


# ───────────────────────── WebSocket proxy ──────────────────────────


@router.websocket("/voice/connect")
async def voice_connect(
    websocket: WebSocket,
    company_id: UUID,
    agent_id: UUID,
):
    """Bidirectional WS proxy between browser and Gemini Live."""
    # Auth (cookies arrive on the WS upgrade; FastAPI doesn't run Depends
    # automatically for WS, so we decode manually).
    cookie = websocket.cookies.get("tm_session")
    if not cookie:
        await websocket.close(code=4401, reason="not authenticated")
        return
    try:
        account_id = decode_session_jwt(cookie)
    except HTTPException as e:
        await websocket.close(code=4401, reason=e.detail)
        return

    async with acquire() as conn:
        try:
            await _ensure_member(conn, company_id, account_id)
            agent = await _load_agent(conn, company_id, agent_id)
        except HTTPException as e:
            await websocket.accept()
            await websocket.send_json({"type": "error", "message": e.detail})
            await websocket.close(code=4404)
            return

    if not os.getenv("GEMINI_API_KEY"):
        await websocket.accept()
        await websocket.send_json({
            "type": "error",
            "message": "voice unavailable: GEMINI_API_KEY not set on the api",
        })
        await websocket.close(code=1011)
        return

    # Build the Gemini Live session.
    model, requires_swap = pick_model(dict(agent))
    voice = voices.get(agent["voice_id"])

    # Recall mem0 + build prompt. We pass an empty query so the agent at
    # least gets the most-relevant memories; a future iteration could
    # update recall live as the user speaks.
    company_row = await _get_company_name(company_id)
    user_row = await _get_user(account_id, company_id)
    memories = []
    try:
        memories = await memory_service.search(
            company_id=company_id, account_id=account_id,
            agent_id=agent_id, query="", limit=5,
        )
    except Exception:
        log.debug("mem0 recall failed; continuing without")

    system_prompt = _build_system_prompt(
        agent, company_row["name"], user_row.get("full_name"),
        user_row.get("title"), memories,
    )
    cfg = build_session_config(
        agent=dict(agent), system_prompt=system_prompt,
        tools=available_tools(),
    )

    session_id = uuid.uuid4().hex
    tool_ctx = ToolContext(
        company_id=company_id, account_id=account_id, agent_id=agent_id,
    )

    await websocket.accept()
    await websocket.send_json({
        "type": "ready",
        "voice": voice.name,
        "voice_label": voice.label,
        "model": model,
        "requires_gemini_brain": requires_swap,
        "session_id": session_id,
    })

    transcript_user: list[str] = []
    transcript_agent: list[str] = []
    start_ts = asyncio.get_event_loop().time()
    client = get_client()

    try:
        async with client.aio.live.connect(model=model, config=cfg) as live:
            log.info(
                "voice session opened agent=%s voice=%s model=%s session=%s",
                agent["name"], voice.name, model, session_id,
            )

            async def pump_browser_to_gemini() -> None:
                """Forward browser frames to Gemini."""
                while True:
                    try:
                        msg_text = await websocket.receive_text()
                    except WebSocketDisconnect:
                        await live.close()
                        return
                    try:
                        msg = json.loads(msg_text)
                    except Exception:
                        continue
                    t = msg.get("type")
                    if t == "audio":
                        data = msg.get("data") or ""
                        try:
                            raw = base64.b64decode(data)
                        except Exception:
                            continue
                        await live.send_realtime_input(
                            audio={
                                "data": raw,
                                "mime_type": "audio/pcm;rate=16000",
                            },
                        )
                    elif t == "end_turn":
                        # Tell Gemini the user's utterance is complete.
                        await live.send_realtime_input(audio_stream_end=True)
                    elif t == "bye":
                        await live.close()
                        return

            async def pump_gemini_to_browser() -> None:
                """Forward Gemini frames to the browser."""
                async for resp in live.receive():
                    # ── audio ─────────────────────────────────────
                    server_content = getattr(resp, "server_content", None)
                    if server_content is not None:
                        model_turn = getattr(server_content, "model_turn", None)
                        if model_turn is not None:
                            for part in model_turn.parts or []:
                                inline = getattr(part, "inline_data", None)
                                if inline is not None and inline.data:
                                    b64 = base64.b64encode(inline.data).decode()
                                    await websocket.send_json({"type": "audio", "data": b64})
                        # ── transcripts ───────────────────────────
                        in_t = getattr(server_content, "input_transcription", None)
                        if in_t is not None and getattr(in_t, "text", None):
                            transcript_user.append(in_t.text)
                            await websocket.send_json({
                                "type": "transcript", "role": "user", "text": in_t.text,
                            })
                        out_t = getattr(server_content, "output_transcription", None)
                        if out_t is not None and getattr(out_t, "text", None):
                            transcript_agent.append(out_t.text)
                            await websocket.send_json({
                                "type": "transcript", "role": "assistant", "text": out_t.text,
                            })

                    # ── tool calls ────────────────────────────────
                    tool_call = getattr(resp, "tool_call", None)
                    if tool_call is not None and tool_call.function_calls:
                        responses = []
                        for fc in tool_call.function_calls:
                            await websocket.send_json({
                                "type": "tool_call",
                                "name": fc.name,
                                "arguments": dict(fc.args) if fc.args else {},
                            })
                            result_json = await execute_tool(
                                fc.name, dict(fc.args) if fc.args else {}, tool_ctx,
                            )
                            try:
                                result = json.loads(result_json)
                            except Exception:
                                result = {"raw": result_json}
                            responses.append({
                                "id": fc.id,
                                "name": fc.name,
                                "response": result,
                            })
                        await live.send_tool_response(function_responses=responses)

            await asyncio.gather(
                pump_browser_to_gemini(),
                pump_gemini_to_browser(),
            )
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.exception("voice session error")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        duration_ms = int((asyncio.get_event_loop().time() - start_ts) * 1000)
        try:
            await websocket.send_json({"type": "closed", "duration_ms": duration_ms})
        except Exception:
            pass
        try:
            await websocket.close()
        except Exception:
            pass
        # Best-effort persistence + cost row. Empty transcripts (user hit
        # Cancel before speaking) skip both so we don't pollute history.
        try:
            user_text = " ".join(transcript_user).strip()
            agent_text = " ".join(transcript_agent).strip()
            if user_text or agent_text:
                await _persist_voice_turn(
                    company_id=company_id, account_id=account_id,
                    agent_id=agent_id, user_text=user_text, agent_text=agent_text,
                )
                # Charge via input_tokens = duration_seconds so the
                # existing per-1M pricing in registry.py turns it into a
                # USD value (see "Gemini Live" row there).
                await record_usage(
                    company_id=company_id, account_id=account_id,
                    agent_id=agent_id, provider="google", model=model,
                    input_tokens=duration_ms // 1000, output_tokens=0,
                    latency_ms=duration_ms, kind="voice",
                )
                # mem0 add — best effort.
                try:
                    msgs = []
                    if user_text:  msgs.append({"role": "user", "content": user_text})
                    if agent_text: msgs.append({"role": "assistant", "content": agent_text})
                    if msgs:
                        await memory_service.add_turn(
                            company_id=company_id, account_id=account_id,
                            agent_id=agent_id, messages=msgs,
                            metadata={"voice": True},
                        )
                except Exception:
                    log.debug("mem0 add (voice) failed; continuing")
        except Exception:
            log.exception("voice end-of-session persistence failed")


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
        # Find or create a conversation for this (account, agent) pair so
        # voice turns mingle with text chat. Mirrors _ensure_conversation
        # in routes/chat but doesn't need a title hint.
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
