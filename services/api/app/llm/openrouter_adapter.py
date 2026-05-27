"""OpenRouter adapter.

OpenRouter exposes an OpenAI-compatible Chat Completions API at
https://openrouter.ai/api/v1. One key + one adapter unlocks DeepSeek,
Llama, Qwen, Mistral, GPT-5, and Claude (passthrough) without writing
five separate adapters.

OpenAI tool-call shape:
  assistant message → {"tool_calls": [{"id", "type":"function", "function":{"name","arguments":"<json>"}}]}
  tool result → {"role":"tool","tool_call_id":"...","content":"<json>"}
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

import httpx

from app.llm.base import LLMMessage, LLMResponse, ToolCall, ToolDef

BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
TIMEOUT_S = 60


class OpenRouterAdapter:
    provider = "openrouter"

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.getenv("OPENROUTER_API_KEY") or ""
        # Reuse one client across calls for keep-alive.
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            timeout=TIMEOUT_S,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                # OpenRouter likes these — show up in their leaderboard.
                "HTTP-Referer": "https://trademaster.local",
                "X-Title": "TradeMaster",
            },
        )

    async def chat(
        self,
        *,
        model: str,
        system: str | None,
        messages: list[LLMMessage],
        tools: list[ToolDef] | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.4,
    ) -> LLMResponse:
        if not self._api_key:
            raise RuntimeError(
                "OPENROUTER_API_KEY not configured; set it in .env to use openrouter models",
            )

        openai_messages: list[dict[str, Any]] = []
        if system:
            openai_messages.append({"role": "system", "content": system})
        for m in messages:
            if m.role == "user":
                openai_messages.append({"role": "user", "content": m.content or ""})
            elif m.role == "assistant":
                msg: dict[str, Any] = {"role": "assistant"}
                if m.content is not None:
                    msg["content"] = m.content
                if m.tool_calls:
                    msg["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": json.dumps(tc.arguments),
                            },
                        }
                        for tc in m.tool_calls
                    ]
                openai_messages.append(msg)
            elif m.role == "tool":
                openai_messages.append({
                    "role": "tool",
                    "tool_call_id": m.tool_call_id or "",
                    "content": m.tool_result or "",
                })

        body: dict[str, Any] = {
            "model": model,
            "messages": openai_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]
            body["tool_choice"] = "auto"

        r = await self._client.post("/chat/completions", json=body)
        if r.status_code >= 400:
            # Surface the provider error so the chat route can show it.
            try:
                detail = r.json()
            except Exception:
                detail = r.text
            raise RuntimeError(f"openrouter error {r.status_code}: {detail}")

        data = r.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}

        text = msg.get("content") or ""
        raw_tool_calls = msg.get("tool_calls") or []
        tool_calls: list[ToolCall] = []
        for tc in raw_tool_calls:
            fn = tc.get("function") or {}
            args_raw = fn.get("arguments") or "{}"
            try:
                args = json.loads(args_raw) if isinstance(args_raw, str) else (args_raw or {})
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(ToolCall(
                id=tc.get("id") or f"call_{uuid.uuid4().hex[:12]}",
                name=fn.get("name", ""),
                arguments=args if isinstance(args, dict) else {},
            ))

        usage = data.get("usage") or {}
        in_toks = int(usage.get("prompt_tokens") or 0)
        out_toks = int(usage.get("completion_tokens") or 0)

        finish_reason = choice.get("finish_reason") or "stop"
        if tool_calls:
            finish = "tool_use"
        elif finish_reason == "length":
            finish = "max_tokens"
        else:
            finish = "stop"

        return LLMResponse(
            text=text.strip(),
            tool_calls=tool_calls,
            input_tokens=in_toks,
            output_tokens=out_toks,
            finish_reason=finish,
        )

    async def aclose(self):
        await self._client.aclose()
