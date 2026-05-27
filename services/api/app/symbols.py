"""Static catalog of Deriv symbols we support in Phase 0.

In later phases we'll pull this from Deriv `active_symbols` per-Company
filtered by the Company's current asset tier (PLAN §8). For now this is a
hand-curated list covering one symbol per asset class.

Symbol codes are Deriv's native identifiers (NOT display names) — they're
what we send to the WebSocket `ticks` request.
"""

from typing import Literal, TypedDict

AssetClass = Literal["synthetic", "forex", "commodity", "crypto", "stock_index"]


class SymbolDef(TypedDict):
    code: str
    display: str
    asset_class: AssetClass
    tier: int                # PLAN §8 — minimum tier required to trade it
    decimals: int            # display precision
    description: str


CATALOG: list[SymbolDef] = [
    # ─── Forex Majors (Tier 1) ───
    {
        "code": "frxEURUSD",
        "display": "EUR / USD",
        "asset_class": "forex",
        "tier": 1,
        "decimals": 5,
        "description": "Euro vs US Dollar — most liquid forex pair.",
    },
    {
        "code": "frxGBPUSD",
        "display": "GBP / USD",
        "asset_class": "forex",
        "tier": 1,
        "decimals": 5,
        "description": "Pound vs US Dollar.",
    },
    {
        "code": "frxUSDJPY",
        "display": "USD / JPY",
        "asset_class": "forex",
        "tier": 1,
        "decimals": 3,
        "description": "US Dollar vs Japanese Yen.",
    },
    # ─── Synthetic Indices (Tier 2) ───
    {
        "code": "R_75",
        "display": "Volatility 75",
        "asset_class": "synthetic",
        "tier": 2,
        "decimals": 4,
        "description": "Deriv synthetic Vol 75 (1-tick/sec GBM-like).",
    },
    {
        "code": "1HZ100V",
        "display": "Volatility 100 (1s)",
        "asset_class": "synthetic",
        "tier": 2,
        "decimals": 2,
        "description": "Deriv synthetic Vol 100 — 1-second variant.",
    },
    # ─── Commodities (Tier 3) ───
    {
        "code": "frxXAUUSD",
        "display": "Gold (XAU / USD)",
        "asset_class": "commodity",
        "tier": 3,
        "decimals": 2,
        "description": "Gold spot in US Dollars.",
    },
    # ─── Crypto (Tier 4) ───
    {
        "code": "cryBTCUSD",
        "display": "BTC / USD",
        "asset_class": "crypto",
        "tier": 4,
        "decimals": 2,
        "description": "Bitcoin vs US Dollar.",
    },
]

BY_CODE: dict[str, SymbolDef] = {s["code"]: s for s in CATALOG}


def visible_to_tier(tier: int) -> list[SymbolDef]:
    """Symbols a Company at the given tier is allowed to trade.
    Phase 0 returns all of them regardless of tier; we surface the `tier`
    field so the UI can display a lock icon for higher-tier markets."""
    return CATALOG
