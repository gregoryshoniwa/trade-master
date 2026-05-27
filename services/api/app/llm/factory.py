"""Pick an LLM adapter based on the provider string on an Agent record."""

from functools import lru_cache

from app.llm.anthropic_adapter import AnthropicAdapter
from app.llm.base import LLMAdapter
from app.llm.gemini_adapter import GeminiAdapter


@lru_cache(maxsize=8)
def get_adapter(provider: str) -> LLMAdapter:
    p = provider.lower()
    if p in ("anthropic", "claude"):
        return AnthropicAdapter()
    if p in ("google", "gemini"):
        return GeminiAdapter()
    raise ValueError(f"unsupported LLM provider: {provider}")
