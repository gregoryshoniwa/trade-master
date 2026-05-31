"""Pick an LLM adapter based on the provider string on an Agent record.

Two callsites:
  - `get_adapter(provider)` — system-key path (env-only). Used by
    backend cron paths that aren't yet company-scoped (postmortem
    narrative generation, etc).
  - `await get_adapter_for_company(provider, company_id)` — prefers
    the per-company encrypted key when set, falls back to env. Used by
    everything that runs on a customer's behalf (chat, manager_review).
"""

from functools import lru_cache

from app import credentials
from app.llm.anthropic_adapter import AnthropicAdapter
from app.llm.base import LLMAdapter
from app.llm.gemini_adapter import GeminiAdapter
from app.llm.openrouter_adapter import OpenRouterAdapter
from app.llm.vllm_adapter import VllmAdapter


def _build(provider: str, api_key: str | None = None) -> LLMAdapter:
    p = provider.lower()
    if p in ("anthropic", "claude"):
        return AnthropicAdapter(api_key=api_key)
    if p in ("google", "gemini"):
        return GeminiAdapter(api_key=api_key)
    if p in ("openrouter",):
        # OpenRouterAdapter's signature predates per-company keys; if it
        # doesn't accept api_key kwarg the env fallback still works.
        try:
            return OpenRouterAdapter(api_key=api_key)  # type: ignore[arg-type]
        except TypeError:
            return OpenRouterAdapter()
    if p in ("vllm", "local"):
        return VllmAdapter()
    if p in ("openai",):
        raise ValueError(
            "OpenAI direct adapter not implemented yet; use 'openrouter' "
            "with model 'openai/gpt-5' instead",
        )
    raise ValueError(f"unsupported LLM provider: {provider}")


@lru_cache(maxsize=8)
def get_adapter(provider: str) -> LLMAdapter:
    """System-key path. Free-tier / system-owned paths use this."""
    return _build(provider)


async def get_adapter_for_company(provider: str, company_id) -> LLMAdapter:
    """Per-company path — pulls the customer's encrypted key when set,
    falls back to env otherwise. Not cached because the key may rotate
    in Settings; cheap to build per call (a few object allocs)."""
    api_key = await credentials.get_llm_key(company_id, provider)
    return _build(provider, api_key=api_key)
