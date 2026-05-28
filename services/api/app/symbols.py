"""Deriv symbol catalog (Phase 1).

Symbols an agent can be configured to trade. Each entry maps to a Deriv
`active_symbols` row. The catalog is intentionally curated — not every Deriv
symbol is in here, but every entry is one we can stream + forecast +
execute against today.

When you add a row, also:
  - update lib/symbols.ts FRIENDLY_SYMBOL so the web shows a nice label;
  - if you want the gateway to subscribe to its tick stream by default,
    add the code to DERIV_DEFAULT_SYMBOL in your .env (the gateway only
    subscribes to symbols in that list).
"""

from typing import Literal, TypedDict

AssetClass = Literal["forex", "synthetic", "commodity", "crypto", "stock_index"]


class SymbolDef(TypedDict):
    code: str
    display: str
    asset_class: AssetClass
    tier: int                # PLAN §8 — minimum tier required to trade it
    decimals: int            # display precision
    description: str


CATALOG: list[SymbolDef] = [
    # ─────────── Forex Majors (Tier 1) ───────────
    {"code": "frxEURUSD", "display": "EUR / USD", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "Euro vs US Dollar — most liquid pair."},
    {"code": "frxGBPUSD", "display": "GBP / USD", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "Pound vs US Dollar."},
    {"code": "frxUSDJPY", "display": "USD / JPY", "asset_class": "forex", "tier": 1, "decimals": 3, "description": "US Dollar vs Japanese Yen."},
    {"code": "frxAUDUSD", "display": "AUD / USD", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "Australian Dollar vs US Dollar."},
    {"code": "frxUSDCAD", "display": "USD / CAD", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "US Dollar vs Canadian Dollar."},
    {"code": "frxUSDCHF", "display": "USD / CHF", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "US Dollar vs Swiss Franc."},
    {"code": "frxNZDUSD", "display": "NZD / USD", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "New Zealand Dollar vs US Dollar."},

    # ─────────── Forex Minors / Crosses (Tier 1) ───────────
    {"code": "frxEURGBP", "display": "EUR / GBP", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "Euro vs Pound."},
    {"code": "frxEURJPY", "display": "EUR / JPY", "asset_class": "forex", "tier": 1, "decimals": 3, "description": "Euro vs Japanese Yen."},
    {"code": "frxGBPJPY", "display": "GBP / JPY", "asset_class": "forex", "tier": 1, "decimals": 3, "description": "Pound vs Japanese Yen."},
    {"code": "frxAUDJPY", "display": "AUD / JPY", "asset_class": "forex", "tier": 1, "decimals": 3, "description": "Australian Dollar vs Japanese Yen."},
    {"code": "frxEURAUD", "display": "EUR / AUD", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "Euro vs Australian Dollar."},
    {"code": "frxEURCAD", "display": "EUR / CAD", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "Euro vs Canadian Dollar."},
    {"code": "frxEURCHF", "display": "EUR / CHF", "asset_class": "forex", "tier": 1, "decimals": 5, "description": "Euro vs Swiss Franc."},

    # ─────────── Synthetic Indices (Tier 2) ───────────
    # RNG-driven random walks — kept for plumbing tests + 24/7 streaming.
    # Live agents should NOT trade these; PLAN backtest finding confirmed
    # no model can predict a random walk.
    {"code": "R_10",    "display": "Volatility 10",  "asset_class": "synthetic", "tier": 2, "decimals": 3, "description": "Deriv synthetic Vol 10."},
    {"code": "R_25",    "display": "Volatility 25",  "asset_class": "synthetic", "tier": 2, "decimals": 3, "description": "Deriv synthetic Vol 25."},
    {"code": "R_50",    "display": "Volatility 50",  "asset_class": "synthetic", "tier": 2, "decimals": 4, "description": "Deriv synthetic Vol 50."},
    {"code": "R_75",    "display": "Volatility 75",  "asset_class": "synthetic", "tier": 2, "decimals": 4, "description": "Deriv synthetic Vol 75."},
    {"code": "R_100",   "display": "Volatility 100", "asset_class": "synthetic", "tier": 2, "decimals": 2, "description": "Deriv synthetic Vol 100."},
    {"code": "1HZ10V",  "display": "Vol 10 (1s)",    "asset_class": "synthetic", "tier": 2, "decimals": 3, "description": "Vol 10 — 1-second variant."},
    {"code": "1HZ25V",  "display": "Vol 25 (1s)",    "asset_class": "synthetic", "tier": 2, "decimals": 3, "description": "Vol 25 — 1-second variant."},
    {"code": "1HZ50V",  "display": "Vol 50 (1s)",    "asset_class": "synthetic", "tier": 2, "decimals": 4, "description": "Vol 50 — 1-second variant."},
    {"code": "1HZ75V",  "display": "Vol 75 (1s)",    "asset_class": "synthetic", "tier": 2, "decimals": 4, "description": "Vol 75 — 1-second variant."},
    {"code": "1HZ100V", "display": "Vol 100 (1s)",   "asset_class": "synthetic", "tier": 2, "decimals": 2, "description": "Vol 100 — 1-second variant."},

    # ─────────── Commodities (Tier 3) ───────────
    {"code": "frxXAUUSD", "display": "Gold / USD",      "asset_class": "commodity", "tier": 3, "decimals": 2, "description": "Gold spot in US Dollars."},
    {"code": "frxXAGUSD", "display": "Silver / USD",    "asset_class": "commodity", "tier": 3, "decimals": 3, "description": "Silver spot in US Dollars."},
    {"code": "frxXPDUSD", "display": "Palladium / USD", "asset_class": "commodity", "tier": 3, "decimals": 2, "description": "Palladium spot."},
    {"code": "frxXPTUSD", "display": "Platinum / USD",  "asset_class": "commodity", "tier": 3, "decimals": 2, "description": "Platinum spot."},

    # ─────────── Crypto (Tier 4) ───────────
    {"code": "cryBTCUSD", "display": "BTC / USD", "asset_class": "crypto", "tier": 4, "decimals": 2, "description": "Bitcoin vs US Dollar."},
    {"code": "cryETHUSD", "display": "ETH / USD", "asset_class": "crypto", "tier": 4, "decimals": 2, "description": "Ethereum vs US Dollar."},

    # ─────────── Stock Indices (Tier 5) ───────────
    {"code": "OTC_SPC",    "display": "US 500",          "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "S&P 500 (OTC)."},
    {"code": "OTC_NDX",    "display": "US Tech 100",     "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "Nasdaq 100 (OTC)."},
    {"code": "OTC_DJI",    "display": "Wall Street 30",  "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "Dow Jones 30 (OTC)."},
    {"code": "OTC_FTSE",   "display": "UK 100",          "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "FTSE 100 (OTC)."},
    {"code": "OTC_GDAXI",  "display": "Germany 40",      "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "DAX 40 (OTC)."},
    {"code": "OTC_N225",   "display": "Japan 225",       "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "Nikkei 225 (OTC)."},
    {"code": "OTC_HSI",    "display": "Hong Kong 50",    "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "Hang Seng (OTC)."},
    {"code": "OTC_AS51",   "display": "Australia 200",   "asset_class": "stock_index", "tier": 5, "decimals": 2, "description": "S&P/ASX 200 (OTC)."},
]

BY_CODE: dict[str, SymbolDef] = {s["code"]: s for s in CATALOG}


def visible_to_tier(tier: int) -> list[SymbolDef]:
    """Symbols a Company at the given tier is allowed to trade.
    Phase 1 returns all of them regardless of tier; we surface the `tier`
    field so the UI can display a lock icon for higher-tier markets."""
    _ = tier
    return CATALOG
