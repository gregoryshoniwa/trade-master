"""Pick an LLM adapter based on the provider string on an Agent record."""

from functools import lru_cache

from app.llm.anthropic_adapter import AnthropicAdapter
from app.llm.base import LLMAdapter
from app.llm.gemini_adapter import GeminiAdapter
from app.llm.openrouter_adapter import OpenRouterAdapter
from app.llm.vllm_adapter import VllmAdapter


@lru_cache(maxsize=8)
def get_adapter(provider: str) -> LLMAdapter:
    p = provider.lower()
    if p in ("anthropic", "claude"):
        return AnthropicAdapter()
    if p in ("google", "gemini"):
        return GeminiAdapter()
    if p in ("openrouter",):
        return OpenRouterAdapter()
    if p in ("vllm", "local"):
        # `local` is a back-compat alias — both route through vLLM's
        # OpenAI-compatible endpoint.
        return VllmAdapter()
    if p in ("openai",):
        raise ValueError(
            "OpenAI direct adapter not implemented yet; use 'openrouter' "
            "with model 'openai/gpt-5' instead",
        )
    raise ValueError(f"unsupported LLM provider: {provider}")
