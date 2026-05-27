"""LLM adapter protocol.

We support two providers in Phase 1 (Anthropic + Google Gemini) behind a
common shape so the chat route doesn't care which is configured per Agent.
The two SDKs disagree on every detail of tool calling and message shape;
this adapter normalizes both onto our schema.
"""

from typing import Literal, Protocol

from pydantic import BaseModel


class ToolDef(BaseModel):
    name: str
    description: str
    parameters: dict       # JSON Schema


class ToolCall(BaseModel):
    id: str
    name: str
    arguments: dict


class LLMMessage(BaseModel):
    role: Literal["user", "assistant", "system", "tool"]
    content: str | None = None
    # Either content (text) or tool_calls/tool_result must be set
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None
    tool_result: str | None = None


class LLMResponse(BaseModel):
    text: str
    tool_calls: list[ToolCall] = []
    input_tokens: int = 0
    output_tokens: int = 0
    finish_reason: Literal["stop", "tool_use", "max_tokens", "error"] = "stop"


class LLMAdapter(Protocol):
    provider: str

    async def chat(
        self,
        *,
        model: str,
        system: str | None,
        messages: list[LLMMessage],
        tools: list[ToolDef] | None = None,
        max_tokens: int = 2048,
        temperature: float = 0.4,
    ) -> LLMResponse: ...
