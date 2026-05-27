"""Google Gemini adapter using the new `google-genai` SDK."""

import os
import uuid

from google import genai
from google.genai import types

from app.llm.base import LLMMessage, LLMResponse, ToolCall, ToolDef


def _role(r: str) -> str:
    # google-genai uses "user" / "model" (not "assistant"). Tools are
    # represented as function_response parts on a user-role message.
    return "model" if r == "assistant" else "user"


class GeminiAdapter:
    provider = "google"

    def __init__(self, api_key: str | None = None):
        self._client = genai.Client(
            api_key=api_key or os.getenv("GEMINI_API_KEY")
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
        # Build content list. Gemini accepts a list of Content objects.
        contents: list[types.Content] = []
        for m in messages:
            if m.role in ("user", "assistant"):
                parts: list[types.Part] = []
                if m.content:
                    parts.append(types.Part(text=m.content))
                for tc in m.tool_calls or []:
                    parts.append(types.Part(
                        function_call=types.FunctionCall(
                            name=tc.name,
                            args=tc.arguments,
                        ),
                    ))
                if parts:
                    contents.append(types.Content(role=_role(m.role), parts=parts))
            elif m.role == "tool":
                # function_response is sent back as a user-role content part.
                contents.append(types.Content(
                    role="user",
                    parts=[types.Part(
                        function_response=types.FunctionResponse(
                            name=m.tool_call_id or "tool",
                            response={"result": m.tool_result or ""},
                        ),
                    )],
                ))

        cfg_kwargs: dict = {
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        # Gemini 2.5 models enable "thinking" by default, and those thinking
        # tokens are drawn from max_output_tokens — so a modest budget gets
        # consumed by reasoning and the visible answer is truncated mid-
        # sentence (or empty). We don't need chain-of-thought for chat or
        # postmortem narratives, so switch it off for deterministic, fully-
        # spent output budgets. (2.0 models reject thinking_config, hence the
        # version guard.)
        if "2.5" in model:
            cfg_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        if system:
            cfg_kwargs["system_instruction"] = system
        if tools:
            cfg_kwargs["tools"] = [
                types.Tool(function_declarations=[
                    types.FunctionDeclaration(
                        name=t.name,
                        description=t.description,
                        parameters=_clean_schema(t.parameters),
                    )
                    for t in tools
                ])
            ]

        config = types.GenerateContentConfig(**cfg_kwargs)

        resp = await self._client.aio.models.generate_content(
            model=model,
            contents=contents,
            config=config,
        )

        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for cand in resp.candidates or []:
            for part in cand.content.parts or []:
                if getattr(part, "text", None):
                    text_parts.append(part.text)
                if getattr(part, "function_call", None):
                    fc = part.function_call
                    tool_calls.append(ToolCall(
                        id=f"call_{uuid.uuid4().hex[:12]}",
                        name=fc.name,
                        arguments=dict(fc.args) if fc.args else {},
                    ))

        finish = "tool_use" if tool_calls else "stop"

        usage = getattr(resp, "usage_metadata", None)
        in_toks = getattr(usage, "prompt_token_count", 0) if usage else 0
        out_toks = getattr(usage, "candidates_token_count", 0) if usage else 0

        return LLMResponse(
            text="\n".join(text_parts).strip(),
            tool_calls=tool_calls,
            input_tokens=in_toks or 0,
            output_tokens=out_toks or 0,
            finish_reason=finish,
        )


def _clean_schema(schema: dict) -> dict:
    """Gemini rejects some JSON Schema fields. Drop them."""
    if not isinstance(schema, dict):
        return schema
    drop = {"additionalProperties", "$schema", "title"}
    out = {k: v for k, v in schema.items() if k not in drop}
    if "properties" in out and isinstance(out["properties"], dict):
        out["properties"] = {
            k: _clean_schema(v) for k, v in out["properties"].items()
        }
    if "items" in out:
        out["items"] = _clean_schema(out["items"])
    return out
