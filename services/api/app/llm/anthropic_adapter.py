"""Anthropic Messages API adapter."""

import json
import os
import uuid

from anthropic import AsyncAnthropic

from app.llm.base import LLMMessage, LLMResponse, ToolCall, ToolDef


class AnthropicAdapter:
    provider = "anthropic"

    def __init__(self, api_key: str | None = None):
        self._client = AsyncAnthropic(api_key=api_key or os.getenv("ANTHROPIC_API_KEY"))

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
        anthro_messages: list[dict] = []
        for m in messages:
            if m.role == "user":
                anthro_messages.append({"role": "user", "content": m.content or ""})
            elif m.role == "assistant":
                content_blocks: list[dict] = []
                if m.content:
                    content_blocks.append({"type": "text", "text": m.content})
                for tc in m.tool_calls or []:
                    content_blocks.append({
                        "type": "tool_use",
                        "id": tc.id,
                        "name": tc.name,
                        "input": tc.arguments,
                    })
                if not content_blocks:
                    continue
                anthro_messages.append({"role": "assistant", "content": content_blocks})
            elif m.role == "tool":
                # Anthropic represents tool results as a user message with a
                # tool_result content block.
                anthro_messages.append({
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": m.tool_call_id or "",
                        "content": m.tool_result or "",
                    }],
                })

        kwargs: dict = {
            "model": model,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": anthro_messages,
        }
        if system:
            kwargs["system"] = system
        if tools:
            kwargs["tools"] = [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                }
                for t in tools
            ]

        resp = await self._client.messages.create(**kwargs)

        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in resp.content:
            btype = getattr(block, "type", None)
            if btype == "text":
                text_parts.append(block.text)
            elif btype == "tool_use":
                tool_calls.append(ToolCall(
                    id=getattr(block, "id", None) or f"call_{uuid.uuid4().hex[:12]}",
                    name=block.name,
                    arguments=block.input or {},
                ))

        finish = "tool_use" if tool_calls else "stop"
        if getattr(resp, "stop_reason", "") == "max_tokens":
            finish = "max_tokens"

        return LLMResponse(
            text="\n".join(text_parts).strip(),
            tool_calls=tool_calls,
            input_tokens=getattr(resp.usage, "input_tokens", 0),
            output_tokens=getattr(resp.usage, "output_tokens", 0),
            finish_reason=finish,
        )


def _safe_json(s: str) -> dict:
    try:
        return json.loads(s)
    except Exception:
        return {}
