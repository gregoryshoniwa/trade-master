"""Catalog of LLMs we can assign to an Agent + their May 2026 pricing.

Single source of truth: the chat route validates an Agent's
(provider, model) pair against this registry, the model-picker UI
hydrates from /api/v1/llm/models, and the Payroll page uses the same
pricing rows to estimate cost.

Pricing is per 1 million tokens, USD. We model token-billed providers
only; for self-hosted (Ollama, local) we set cost to 0 — the cost
there is compute, not metered tokens.

NOTE: "Gemini 3.5 Flash" doesn't exist. The current Gemini lineup
(May 2026) is 3.1 Pro · 2.5 Pro · 2.5 Flash. See PLAN.md §1.1.
"""

from dataclasses import dataclass
from typing import Literal

Category = Literal["cloud", "self_hosted"]


@dataclass(frozen=True)
class ModelDef:
    provider: str               # which LLMAdapter handles this
    model: str                  # exact ID for the API call
    label: str                  # human-friendly name
    family: str                 # claude / gemini / openai / deepseek / llama / qwen / mistral / local
    category: Category
    context_window: int
    input_cost_per_1m_usd: float
    output_cost_per_1m_usd: float
    supports_tools: bool = True
    # Hint for the UI — speed/quality positioning
    tier: Literal["frontier", "mid", "fast", "tiny"] = "mid"


CATALOG: list[ModelDef] = [
    # ────────────────── Anthropic (direct) ──────────────────
    ModelDef(
        provider="anthropic", model="claude-opus-4-7",
        label="Claude Opus 4.7", family="claude", category="cloud",
        context_window=200_000,
        input_cost_per_1m_usd=15.0, output_cost_per_1m_usd=75.0,
        tier="frontier",
    ),
    ModelDef(
        provider="anthropic", model="claude-sonnet-4-6",
        label="Claude Sonnet 4.6", family="claude", category="cloud",
        context_window=200_000,
        input_cost_per_1m_usd=3.0, output_cost_per_1m_usd=15.0,
        tier="mid",
    ),
    ModelDef(
        provider="anthropic", model="claude-haiku-4-5",
        label="Claude Haiku 4.5", family="claude", category="cloud",
        context_window=200_000,
        input_cost_per_1m_usd=0.80, output_cost_per_1m_usd=4.0,
        tier="fast",
    ),

    # ────────────────── Google Gemini (direct) ──────────────────
    ModelDef(
        provider="google", model="gemini-3.1-pro",
        label="Gemini 3.1 Pro", family="gemini", category="cloud",
        context_window=2_000_000,
        # Under 200K context. Above 200K context Google doubles the
        # rate; the Payroll projection treats this as a soft estimate.
        input_cost_per_1m_usd=2.0, output_cost_per_1m_usd=12.0,
        tier="frontier",
    ),
    ModelDef(
        provider="google", model="gemini-2.5-pro",
        label="Gemini 2.5 Pro", family="gemini", category="cloud",
        context_window=1_000_000,
        input_cost_per_1m_usd=1.25, output_cost_per_1m_usd=5.0,
        tier="mid",
    ),
    ModelDef(
        provider="google", model="gemini-2.5-flash",
        label="Gemini 2.5 Flash", family="gemini", category="cloud",
        context_window=1_000_000,
        input_cost_per_1m_usd=0.075, output_cost_per_1m_usd=0.30,
        tier="fast",
    ),

    # ────────────────── OpenAI direct ──────────────────
    # Listed so the UI can show them; will only work if OPENAI_API_KEY
    # is configured.
    ModelDef(
        provider="openai", model="gpt-5",
        label="GPT-5", family="openai", category="cloud",
        context_window=400_000,
        input_cost_per_1m_usd=2.50, output_cost_per_1m_usd=10.0,
        tier="frontier",
    ),
    ModelDef(
        provider="openai", model="gpt-4o",
        label="GPT-4o", family="openai", category="cloud",
        context_window=128_000,
        input_cost_per_1m_usd=2.50, output_cost_per_1m_usd=10.0,
        tier="mid",
    ),
    ModelDef(
        provider="openai", model="gpt-4o-mini",
        label="GPT-4o mini", family="openai", category="cloud",
        context_window=128_000,
        input_cost_per_1m_usd=0.15, output_cost_per_1m_usd=0.60,
        tier="fast",
    ),

    # ────────────────── OpenRouter (gateway) ──────────────────
    # OpenRouter's `model` IDs are the route. The OpenRouterAdapter
    # passes them straight through. Pricing matches OpenRouter's
    # advertised rates plus their ~0% markup.
    ModelDef(
        provider="openrouter", model="deepseek/deepseek-v3.1",
        label="DeepSeek V3.1", family="deepseek", category="cloud",
        context_window=128_000,
        input_cost_per_1m_usd=0.27, output_cost_per_1m_usd=1.10,
        tier="mid",
    ),
    ModelDef(
        provider="openrouter", model="deepseek/deepseek-r1",
        label="DeepSeek R1 (reasoning)", family="deepseek", category="cloud",
        context_window=128_000,
        input_cost_per_1m_usd=0.55, output_cost_per_1m_usd=2.19,
        tier="frontier",
    ),
    ModelDef(
        provider="openrouter", model="meta-llama/llama-3.3-70b-instruct",
        label="Llama 3.3 70B", family="llama", category="cloud",
        context_window=128_000,
        input_cost_per_1m_usd=0.40, output_cost_per_1m_usd=0.40,
        tier="mid",
    ),
    ModelDef(
        provider="openrouter", model="qwen/qwen2.5-72b-instruct",
        label="Qwen 2.5 72B", family="qwen", category="cloud",
        context_window=131_000,
        input_cost_per_1m_usd=0.40, output_cost_per_1m_usd=0.40,
        tier="mid",
    ),
    ModelDef(
        provider="openrouter", model="mistralai/mistral-large-2411",
        label="Mistral Large 2.1", family="mistral", category="cloud",
        context_window=128_000,
        input_cost_per_1m_usd=2.00, output_cost_per_1m_usd=6.00,
        tier="mid",
    ),
    ModelDef(
        provider="openrouter", model="anthropic/claude-3.5-sonnet",
        label="Claude 3.5 Sonnet (via OpenRouter)", family="claude", category="cloud",
        context_window=200_000,
        input_cost_per_1m_usd=3.0, output_cost_per_1m_usd=15.0,
        tier="mid",
    ),

    # ────────────────── Local / self-hosted (Ollama compatible) ──────────────────
    # No metered cost — "freelancer vs employee" framing on the
    # Payroll page treats these as $0 cash burn (you pay for compute
    # separately).
    ModelDef(
        provider="local", model="llama3.2:3b",
        label="Llama 3.2 3B (local)", family="local", category="self_hosted",
        context_window=128_000,
        input_cost_per_1m_usd=0.0, output_cost_per_1m_usd=0.0,
        tier="tiny",
    ),
    ModelDef(
        provider="local", model="phi3:mini",
        label="Phi-3 mini (local)", family="local", category="self_hosted",
        context_window=128_000,
        input_cost_per_1m_usd=0.0, output_cost_per_1m_usd=0.0,
        tier="tiny",
    ),
    ModelDef(
        provider="local", model="qwen2.5:7b",
        label="Qwen 2.5 7B (local)", family="local", category="self_hosted",
        context_window=131_000,
        input_cost_per_1m_usd=0.0, output_cost_per_1m_usd=0.0,
        tier="fast",
    ),
]

BY_KEY: dict[tuple[str, str], ModelDef] = {(m.provider, m.model): m for m in CATALOG}


def get_model(provider: str, model: str) -> ModelDef | None:
    return BY_KEY.get((provider, model))


def is_known(provider: str, model: str) -> bool:
    return (provider, model) in BY_KEY


def estimate_cost_usd(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    """Map (provider, model, tokens) → estimated USD. Returns 0 if we
    don't know the model — better to under-report than to lie."""
    m = BY_KEY.get((provider, model))
    if m is None:
        return 0.0
    return (
        input_tokens / 1_000_000 * m.input_cost_per_1m_usd
        + output_tokens / 1_000_000 * m.output_cost_per_1m_usd
    )
