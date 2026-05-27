"""vLLM adapter.

vLLM exposes an OpenAI-compatible Chat Completions endpoint at
`{VLLM_BASE_URL}/chat/completions`. We reuse the OpenAI wire format —
this adapter is the same shape as OpenRouter's, just pointed at a
self-hosted server with no auth header by default.

Run vLLM however you like:

  # Native, on a CUDA box, recommended for any model ≥ 7B
  vllm serve Qwen/Qwen2.5-7B-Instruct --port 8000

  # Docker (works on linux/amd64; on Mac M1 only with a tiny model and
  # via the experimental CPU backend, very slow)
  docker run -p 8000:8000 vllm/vllm-openai:latest \\
      --model microsoft/Phi-3-mini-4k-instruct

Then either set VLLM_BASE_URL=http://localhost:8000/v1 in .env if running
on the host, or use http://vllm:8000/v1 if the vllm container is on the
same docker network.
"""

from __future__ import annotations

import json
import os
import uuid
from typing import Any

import httpx

from app.llm.base import LLMMessage, LLMResponse, ToolCall, ToolDef

DEFAULT_BASE_URL = os.getenv("VLLM_BASE_URL", "http://vllm:8000/v1")
DEFAULT_API_KEY = os.getenv("VLLM_API_KEY", "")  # most local servers don't require auth
TIMEOUT_S = 120  # local boxes can be slower than cloud


class VllmAdapter:
    provider = "vllm"

    def __init__(self, base_url: str | None = None, api_key: str | None = None):
        self._client = httpx.AsyncClient(
            base_url=base_url or DEFAULT_BASE_URL,
            timeout=TIMEOUT_S,
            headers={"Authorization": f"Bearer {api_key or DEFAULT_API_KEY}"}
            if (api_key or DEFAULT_API_KEY)
            else {},
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

        try:
            r = await self._client.post("/chat/completions", json=body)
        except httpx.HTTPError as e:
            raise RuntimeError(
                f"vllm: connection failed — is a vLLM server running at "
                f"{self._client.base_url}? ({e})"
            ) from e
        if r.status_code >= 400:
            try:
                detail = r.json()
            except Exception:
                detail = r.text
            raise RuntimeError(f"vllm error {r.status_code}: {detail}")

        data = r.json()
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}

        text = msg.get("content") or ""
        tool_calls: list[ToolCall] = []
        for tc in msg.get("tool_calls") or []:
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
        finish_reason = choice.get("finish_reason") or "stop"
        finish = (
            "tool_use" if tool_calls
            else "max_tokens" if finish_reason == "length"
            else "stop"
        )

        return LLMResponse(
            text=text.strip(),
            tool_calls=tool_calls,
            input_tokens=int(usage.get("prompt_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or 0),
            finish_reason=finish,
        )

    async def aclose(self):
        await self._client.aclose()
