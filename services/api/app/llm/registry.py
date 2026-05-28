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

    # ────────────────── Self-hosted via vLLM (OpenAI-compatible) ──────────────────
    # vLLM serves these from {VLLM_BASE_URL}. No metered token cost —
    # the Payroll page treats them as "self-hosted employees" with $0
    # cash burn (you pay for compute separately).
    ModelDef(
        provider="vllm", model="microsoft/Phi-3-mini-4k-instruct",
        label="Phi-3 mini (vLLM)", family="vllm", category="self_hosted",
        context_window=4_096,
        input_cost_per_1m_usd=0.0, output_cost_per_1m_usd=0.0,
        tier="tiny",
    ),
    ModelDef(
        provider="vllm", model="meta-llama/Llama-3.2-3B-Instruct",
        label="Llama 3.2 3B (vLLM)", family="vllm", category="self_hosted",
        context_window=128_000,
        input_cost_per_1m_usd=0.0, output_cost_per_1m_usd=0.0,
        tier="tiny",
    ),
    ModelDef(
        provider="vllm", model="Qwen/Qwen2.5-7B-Instruct",
        label="Qwen 2.5 7B (vLLM)", family="vllm", category="self_hosted",
        context_window=131_072,
        input_cost_per_1m_usd=0.0, output_cost_per_1m_usd=0.0,
        tier="fast",
    ),
    ModelDef(
        provider="vllm", model="meta-llama/Llama-3.3-70B-Instruct",
        label="Llama 3.3 70B (vLLM — needs GPU)", family="vllm", category="self_hosted",
        context_window=128_000,
        input_cost_per_1m_usd=0.0, output_cost_per_1m_usd=0.0,
        tier="mid",
    ),
    # ────────────────── Gemini Live (voice) ──────────────────
    # The voice route records usage with kind="voice", latency_ms=session
    # duration, and zero tokens. We expose a synthetic model row priced
    # treating per-second duration as "input tokens" so the existing usage
    # table + Payroll page can compute a number without a schema change.
    # Calibration: voice route writes input_tokens = duration_seconds. At
    # $100/1M and 1 token=1s, a 60s call ≈ $0.006 — light overcharge vs.
    # Google's ~$0.10/min native-audio billing. Adjust as the price firms.
    ModelDef(
        provider="google", model="gemini-2.0-flash-live-001",
        label="Gemini 2.0 Flash Live (voice)", family="gemini", category="cloud",
        context_window=32_000,
        input_cost_per_1m_usd=100.0, output_cost_per_1m_usd=0.0,
        supports_tools=True, tier="mid",
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
